import os
import sys
import io
import warnings
from dotenv import dotenv_values
from google import genai
from google.genai import errors

# Suppress AFC user warnings from SDK
warnings.filterwarnings("ignore")

# Ensure UTF-8 output encoding across Windows terminals
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, io.UnsupportedOperation):
        pass

def test_gemini_key(api_key: str):
    """
    Tests a Gemini API key and determines if it is active, leaked, blocked, or invalid.
    """
    if not api_key or api_key.strip() == "" or "your_" in api_key.lower():
        return {
            "status": "UNCONFIGURED",
            "is_leaked": False,
            "details": "Key is empty or contains placeholder text."
        }

    try:
        client = genai.Client(api_key=api_key)
        
        # Test 1: Fetch model metadata to verify authentication credentials
        pager = client.models.list(config={"page_size": 1})
        for _ in pager:
            break
            
        # Test 2: Perform a lightweight generation check
        model_name = "gemini-3.8-flash"
        test_resp = client.models.generate_content(
            model=model_name,
            contents="ping"
        )
        preview = test_resp.text.strip().replace("\n", " ") if test_resp.text else "OK"
        if len(preview) > 30:
            preview = preview[:27] + "..."
            
        return {
            "status": "ACTIVE (NOT LEAKED)",
            "is_leaked": False,
            "details": f"Authenticated successfully with {model_name}. Response: \"{preview}\""
        }
    except errors.ClientError as e:
        err_msg = str(e).lower()
        if "leaked" in err_msg or "compromised" in err_msg:
            return {
                "status": "LEAKED",
                "is_leaked": True,
                "details": f"Key reported as leaked/compromised by Google: {e}"
            }
        elif "blocked" in err_msg or "suspended" in err_msg or "api_key_service_blocked" in err_msg:
            return {
                "status": "BLOCKED",
                "is_leaked": False,
                "details": f"Key is blocked or suspended: {e}"
            }
        elif "api_key_invalid" in err_msg or "api key not valid" in err_msg:
            return {
                "status": "INVALID",
                "is_leaked": False,
                "details": f"API key is invalid or deleted: {e}"
            }
        elif "resource_exhausted" in err_msg or "quota" in err_msg:
            return {
                "status": "QUOTA EXCEEDED (NOT LEAKED)",
                "is_leaked": False,
                "details": f"Key is valid and active, but quota limit was reached: {e}"
            }
        else:
            return {
                "status": f"CLIENT ERROR ({e.code if hasattr(e, 'code') else 'Unknown'})",
                "is_leaked": "leaked" in err_msg or "compromised" in err_msg,
                "details": str(e)
            }
    except Exception as e:
        err_msg = str(e).lower()
        is_leaked = "leaked" in err_msg or "compromised" in err_msg
        return {
            "status": "ERROR",
            "is_leaked": is_leaked,
            "details": str(e)
        }

def main():
    env_file = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(env_file):
        print(f"[!] No .env file found at {env_file}")
        sys.exit(1)

    env_vars = dotenv_values(env_file)
    
    # Identify keys to test: variables with GEMINI or KEY in name, excluding MONGO
    key_entries = [
        (k, v) for k, v in env_vars.items()
        if ("GEMINI" in k.upper() or "KEY" in k.upper()) and "MONGO" not in k.upper()
    ]

    if not key_entries:
        print("[!] No API keys found in .env to test.")
        return

    print("=" * 80)
    print("                 GEMINI API KEY STATUS & LEAK DETECTOR")
    print("=" * 80)
    print(f"Env File: {env_file}")
    print(f"Keys Found: {len(key_entries)}\n")

    results = []

    for key_name, key_val in key_entries:
        print("-" * 80)
        print(f"Variable : {key_name}")
        print(f"API Key  : {key_val if key_val else '<NOT SET>'}")
        
        result = test_gemini_key(key_val)
        
        status_tag = f"[{result['status']}]"
        if result['is_leaked']:
            status_tag += " ⚠️ MARKED AS LEAKED"
            
        print(f"Status   : {status_tag}")
        print(f"Details  : {result['details']}")
        results.append((key_name, key_val, result))

    print("\n" + "=" * 80)
    print("                                SUMMARY")
    print("=" * 80)
    print(f"{'Variable':<18} | {'Status':<25} | {'API Key'}")
    print("-" * 80)
    for key_name, key_val, result in results:
        status_str = "[LEAKED]" if result['is_leaked'] else f"[{result['status']}]"
        print(f"{key_name:<18} | {status_str:<25} | {key_val}")
    print("=" * 80)

if __name__ == "__main__":
    main()
