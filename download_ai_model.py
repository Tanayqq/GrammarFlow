import os
import subprocess
import sys

def setup_huggingface_hub():
    """Ensure huggingface_hub is installed."""
    try:
        import huggingface_hub
    except ImportError:
        print("📦 Installing huggingface-hub library...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface-hub"])
        import huggingface_hub

def download_mistral():
    setup_huggingface_hub()
    import huggingface_hub
    
    print("\n🚀 AI Model Setup (Mistral-7B Int4 - Official Apple Port)")
    print("-------------------------")
    print("✅ This model is officially optimized by Apple for the Neural Engine.")
    print("✅ It uses 4-bit (Int4) quantization to fit in 4GB of RAM.")
    
    model_id = "apple/mistral-coreml"
    target_dir = "GrammarFlow-macOS/GrammarFlow/Resources/Models"
    
    os.makedirs(target_dir, exist_ok=True)
    
    print(f"\n📥 Downloading {model_id} from Hugging Face...")
    
    try:
        # Download specifically the Int4 version to save space/RAM
        path = huggingface_hub.snapshot_download(
            repo_id=model_id,
            local_dir=os.path.join(target_dir, "mistral_7b_int4"),
            # We only want the Int4 mlpackage
            allow_patterns=["*InstructInt4.mlpackage/*", "*.json", "README.md"]
        )
        print(f"\n✅ Successfully downloaded to: {path}")
        print("\nNext Steps:")
        print("1. Open Xcode")
        print("2. Ensure the 'Models' folder includes the 'mistral_7b_int4' directory")
        print("3. Build and Run GrammarFlow!")
        
    except Exception as e:
        print(f"\n❌ Download failed: {e}")

if __name__ == "__main__":
    download_mistral()
