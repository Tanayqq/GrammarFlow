from huggingface_hub import HfApi
import sys

api = HfApi()
try:
    print("🔍 Searching for 'gemma' models in 'apple' organization...")
    models = api.list_models(author="apple", search="gemma")
    for model in models:
        print(f"Found: {model.modelId}")
except Exception as e:
    print(f"Error: {e}")
