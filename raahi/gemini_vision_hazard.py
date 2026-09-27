import os
import sys
import argparse
import google.generativeai as genai
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

def analyze_image_with_gemini(image_path):
    # Configure Gemini API
    api_key = os.environ.get("GEMINI_API_KEY2")
    if not api_key:
        print("Error: GEMINI_API_KEY environment variable not set.")
        print("Please set it using: set GEMINI_API_KEY=your_api_key_here")
        return

    genai.configure(api_key=api_key)

    # Initialize the Gemini 1.5 Flash model which is optimized for fast multimodal tasks
    model = genai.GenerativeModel('gemini-3.5-flash-lite')

    # Load image
    if not os.path.exists(image_path):
        print(f"Error: Image file not found at {image_path}")
        return
        
    try:
        img = Image.open(image_path)
    except Exception as e:
        print(f"Error opening image: {e}")
        return

    # Define the strict mobility instructor prompt
    prompt = """
    You are a mobility instructor for a visually impaired person. 
    Scan this image for immediate physical hazards (furniture, people, steps, poles, etc.).
    Map their position using clock-face directions and estimated distance (e.g., "Couch at 12 o'clock, 2 steps ahead" or "Bike on the immediate right").
    KEEP YOUR RESPONSE STRICTLY UNDER 10 WORDS for fast physical reaction times.
    """

    print(f"Sending {image_path} to Gemini...")
    try:
        response = model.generate_content([prompt, img])
        print("\n=== GEMINI INSTRUCTOR RESPONSE ===")
        print(response.text.strip())
        print("==================================\n")
    except Exception as e:
        print(f"Error calling Gemini API: {e}")

def main():
    image_path = "testImgs/img1.png"
    analyze_image_with_gemini(image_path)

if __name__ == "__main__":
    main()
