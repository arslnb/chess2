#!/usr/bin/env python3
"""
Generate all chess pieces using Gemini 3 Pro image generation.
Generates white pieces, then recolors to black.
Removes green chroma-key background to transparent PNG.
"""

import sys
import os
import json
import base64
import urllib.request
import urllib.parse
from PIL import Image
import numpy as np
import io
import time

API_KEY = os.environ.get("GEMINI_API_KEY") or sys.argv[1]
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "public", "pieces")
os.makedirs(OUTPUT_DIR, exist_ok=True)

PIECES = {
    "K": "King",
    "Q": "Queen", 
    "B": "Bishop",
    "N": "Knight",
    "R": "Rook",
    "P": "Pawn",
    "D": "Dragon",
    "S": "Shadow (hooded cloaked figure)",
}

BASE_PROMPT = (
    "A single {piece_name} chess piece in a cartoon style similar to chess.com's Neo piece set. "
    "The piece is white/cream colored with clean outlines. Simple, bold, 2D cartoon style with subtle shading. "
    "The piece should be centered, facing forward, on a solid bright green (#00FF00) background. "
    "No text, no labels, no board, no other objects. Just the single piece."
)

def generate_piece(piece_code, piece_name):
    """Generate a white piece image using Gemini."""
    prompt = BASE_PROMPT.format(piece_name=piece_name)
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key={API_KEY}"
    
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    
    print(f"  Generating {piece_name} ({piece_code})...")
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read().decode("utf-8"))
    
    # Extract image from response
    for candidate in result.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if "inlineData" in part:
                img_data = base64.b64decode(part["inlineData"]["data"])
                return img_data
    
    raise Exception(f"No image in response for {piece_name}")


def remove_green_bg(img_data):
    """Remove green chroma-key background and make it transparent."""
    img = Image.open(io.BytesIO(img_data)).convert("RGBA")
    arr = np.array(img, dtype=np.float32)
    
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    
    # Detect green: high green channel, low red and blue relative to green
    green_mask = (g > 100) & (g > r * 1.3) & (g > b * 1.3)
    
    # Also catch lighter greens near edges
    green_mask2 = (g > 150) & (g > r * 1.1) & (g > b * 1.1)
    green_mask = green_mask | green_mask2
    
    arr[green_mask, 3] = 0  # Set alpha to 0 for green pixels
    
    result = Image.fromarray(arr.astype(np.uint8))
    
    # Crop to content
    bbox = result.getbbox()
    if bbox:
        result = result.crop(bbox)
    
    # Resize to 256x256 with padding to keep aspect ratio
    result.thumbnail((256, 256), Image.LANCZOS)
    final = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    offset = ((256 - result.width) // 2, (256 - result.height) // 2)
    final.paste(result, offset)
    
    buf = io.BytesIO()
    final.save(buf, format="PNG")
    return buf.getvalue()


def recolor_to_black(img_data):
    """Recolor a white piece to a dark/black piece while preserving shape and shading."""
    img = Image.open(io.BytesIO(img_data)).convert("RGBA")
    arr = np.array(img, dtype=np.float32)
    
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    
    # Only modify visible pixels (alpha > 0)
    visible = a > 10
    
    # Invert the luminance: bright white becomes dark, shadows stay
    # But keep it looking nice -- dark gray to black tones
    if visible.any():
        luminance = (0.299 * r + 0.587 * g + 0.114 * b)
        
        # Map: high luminance (white, ~255) -> dark (~40-60)
        # Map: low luminance (shadows, ~0-50) -> very dark (~10-30)  
        # Map: mid luminance (shading, ~128) -> mid-dark (~30-50)
        new_lum = np.where(visible, 20 + (255 - luminance) * 0.15, luminance)
        
        # Preserve relative shading
        scale = np.where(luminance > 1, new_lum / luminance, 1.0)
        
        arr[:,:,0] = np.where(visible, np.clip(r * scale, 0, 255), r)
        arr[:,:,1] = np.where(visible, np.clip(g * scale, 0, 255), g)
        arr[:,:,2] = np.where(visible, np.clip(b * scale, 0, 255), b)
    
    result = Image.fromarray(arr.astype(np.uint8))
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return buf.getvalue()


def main():
    print("=== Chess 2 Piece Generator ===\n")
    
    # Check for Pillow
    print("Generating 8 white pieces...\n")
    
    white_pieces = {}
    for code, name in PIECES.items():
        try:
            raw_img = generate_piece(code, name)
            clean_img = remove_green_bg(raw_img)
            white_pieces[code] = clean_img
            
            # Save white piece
            path = os.path.join(OUTPUT_DIR, f"w{code}.png")
            with open(path, "wb") as f:
                f.write(clean_img)
            print(f"  Saved w{code}.png")
            
            time.sleep(1)  # Rate limit
            
        except Exception as e:
            print(f"  ERROR generating {name}: {e}")
    
    print("\nRecoloring to black pieces...\n")
    
    for code, img_data in white_pieces.items():
        try:
            black_img = recolor_to_black(img_data)
            path = os.path.join(OUTPUT_DIR, f"b{code}.png")
            with open(path, "wb") as f:
                f.write(black_img)
            print(f"  Saved b{code}.png")
        except Exception as e:
            print(f"  ERROR recoloring {code}: {e}")
    
    print(f"\nDone! All pieces saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
