#!/usr/bin/env python3
"""Generate a chess piece image using Gemini imagen, then chroma-key green to transparent."""

import sys
import os
import json
import base64
import urllib.request
import urllib.parse
from PIL import Image
import io
import numpy as np

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("Set GEMINI_API_KEY env var")
    sys.exit(1)

def generate_piece(piece_name, color, output_path):
    """Generate a single chess piece image with transparent background."""
    
    color_word = "white" if color == "w" else "black"
    
    # Special pieces
    piece_names = {
        "K": "King",
        "Q": "Queen", 
        "R": "Rook",
        "B": "Bishop",
        "N": "Knight",
        "P": "Pawn",
        "D": "Dragon",
        "S": "Shadow"
    }
    
    name = piece_names.get(piece_name, piece_name)
    
    prompt = (
        f"A single {color_word} {name} chess piece in a flat cartoon style similar to chess.com's Neo piece set. "
        f"Clean vector-like illustration with bold outlines, simple shading, and a playful but recognizable design. "
        f"The piece should be centered and facing forward. "
        f"The background must be solid bright green (#00FF00) with absolutely nothing else. "
        f"No shadows on the background, no gradients, no board, no other objects. Just the piece on pure green."
    )
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key={API_KEY}"
    
    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    
    print(f"Generating {color_word} {name}...")
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read())
    
    # Extract image
    for part in result["candidates"][0]["content"]["parts"]:
        if "inlineData" in part:
            img_data = base64.b64decode(part["inlineData"]["data"])
            
            # Open and chroma-key
            img = Image.open(io.BytesIO(img_data)).convert("RGBA")
            arr = np.array(img)
            
            # Green screen removal: find pixels close to #00FF00
            r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
            green_mask = (g > 150) & (r < 100) & (b < 100)
            
            # Also catch lighter greens
            green_mask2 = (g > 180) & (r < 130) & (b < 130) & (g > r + 50) & (g > b + 50)
            mask = green_mask | green_mask2
            
            arr[mask] = [0, 0, 0, 0]
            
            result_img = Image.fromarray(arr)
            
            # Resize to 512x512 for web
            result_img = result_img.resize((512, 512), Image.LANCZOS)
            
            result_img.save(output_path, "PNG")
            print(f"Saved: {output_path}")
            return True
    
    print("No image in response!")
    return False


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sample"
    
    if mode == "sample":
        generate_piece("K", "w", "/Users/arslnb/Desktop/sample_wK.png")
        print("Sample saved to ~/Desktop/sample_wK.png")
    elif mode == "all":
        pieces_dir = "/Users/arslnb/Desktop/Chess2/online/public/pieces"
        pieces = ["K", "Q", "R", "B", "N", "P", "D", "S"]
        colors = ["w", "b"]
        for c in colors:
            for p in pieces:
                out = os.path.join(pieces_dir, f"{c}{p}.png")
                try:
                    generate_piece(p, c, out)
                except Exception as e:
                    print(f"Error generating {c}{p}: {e}")
        print("All pieces generated!")
