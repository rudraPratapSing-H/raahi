import os
from dotenv import load_dotenv
from google import genai
from pymongo import MongoClient
import sys

def test_connections():
    load_dotenv()
    
    gemini_key = os.getenv("GEMINI_API_KEY")
    mongo_uri = os.getenv("MONGO_URI")
    
    if not gemini_key:
        print("[ERROR] GEMINI_API_KEY not found in .env file.")
    else:
        print("Checking Gemini API connection...")
        try:
            client = genai.Client(api_key=gemini_key)
            client.models.embed_content(
                model='gemini-embedding-2',
                contents='test connection'
            )
            print("[SUCCESS] Gemini API connection is working!")
        except Exception as e:
            print(f"[FAILED] Gemini API connection error: {e}")
            
    print("-" * 40)
    
    if not mongo_uri:
        print("[ERROR] MONGO_URI not found in .env file.")
    else:
        print("Checking MongoDB Atlas connection...")
        try:
            mongo_client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            mongo_client.admin.command('ping')
            print("[SUCCESS] MongoDB Atlas connection is working!")
        except Exception as e:
            print(f"[FAILED] MongoDB Atlas connection error: {e}")

if __name__ == "__main__":
    test_connections()
