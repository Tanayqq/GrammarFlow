#!/bin/bash

# GrammarFlow Model Setup Script
# This script prepares the local models for offline use.

MODEL_DIR="GrammarFlow-macOS/GrammarFlow/Resources/Models"

echo "🎯 GrammarFlow AI Model Setup"
echo "------------------------------"

mkdir -p "$MODEL_DIR"

echo "1. Gemma 2b (Google)"
echo "   Download gemma_2b_it_int8.mlmodelc from Apple/HuggingFace."
echo "   Place it in: $MODEL_DIR/gemma_2b_int8.mlmodelc"
echo ""

echo "2. Llama 3 8B (Meta)"
echo "   Download llama_3_8b_it_int8.mlmodelc from Apple/HuggingFace."
echo "   Place it in: $MODEL_DIR/llama_3_8b_it_int8.mlmodelc"
echo ""

echo "Note: Due to file sizes (>1GB), these must be added manually to the Xcode project."
echo "Once placed, rebuild the app in Xcode to bundle them into the app."
