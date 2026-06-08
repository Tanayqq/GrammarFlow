from huggingface_hub import HfApi
import sys

api = HfApi()
try:
    print("🔍 Searching for 'gemma coreml' models on Hugging Face...")
    models = api.list_models(search="gemma coreml")
    for model in models:
        print(f"Found: {model.modelId} (Downloads: {getattr(model, 'downloads', 0)})")
except Exception as e:
    print(f"Error: {e}")
