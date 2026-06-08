# GrammarFlow

**Offline-first desktop grammar assistant with real-time AI predictions**

## Architecture

GrammarFlow uses **Pure Native** architecture for deepest OS integration:

- **macOS** (v1.0): Swift + SwiftUI + CoreML + Accessibility API
- **Windows** (v1.1): C# + .NET MAUI + ONNX Runtime + UI Automation

## Current Status

🚧 **In Development** - Phase 5: Polish & Testing

### Phase 1: macOS Foundation ✅
- [x] Architecture pivot to Pure Native approved
- [x] All documentation updated
- [x] Electron codebase removed
- [x] macOS project structure created
- [x] Accessibility API integration (AccessibilityMonitor, PermissionManager, CursorTracker)
- [x] Menu bar app with status indicator

### Phase 2: Text Manipulation ✅
- [x] TextInjector service (insert/replace text)
- [x] HotkeyManager service (global shortcuts)
- [x] Cmd+R rewrite hotkey registered
- [x] Cmd+Shift+G grammar check hotkey registered

### Phase 3: AI Integration ✅
- [x] AI/AIModels.swift - Core data models
- [x] AI/PredictionService.swift - Next-word predictions
- [x] AI/GrammarService.swift - Grammar/spelling checks
- [x] AI/RewriteService.swift - Style/tone rewriting
- [x] Prediction popup window (shows while typing)
- [ ] CoreML model conversion (when models are trained)

### Phase 4: UI Components ✅
- [x] PredictionPopupView - Glassmorphism word suggestions
- [x] GrammarAlertView - Error cards with apply/ignore
- [x] RewriteSheetView - Style/tone picker with alternatives
- [x] WindowControllers - NSWindow management for SwiftUI

## Development Timeline

- **Weeks 1-2**: macOS Foundation & Accessibility
- **Weeks 3-4**: Accessibility Complete
- **Weeks 5-6**: AI Integration (CoreML)
- **Week 8**: v1.0 macOS Release 🎉
- **Weeks 9-16**: Windows Development
- **Week 16**: v1.1 Windows Release 🎉

## Documentation

Comprehensive documentation available in `/docs`:

- [PRD.md](docs/PRD.md) - Product Requirements
- [DeepDiveResearch.md](docs/DeepDiveResearch.md) - Technology Stack
- [MasterImplementationPlan.md](docs/MasterImplementationPlan.md) - Architecture
- [VisualDesignBlueprint.md](docs/VisualDesignBlueprint.md) - UI/UX Design
- [TaskList.md](docs/TaskList.md) - Development Tasks

## Prerequisites

**macOS Development:**
- macOS 13.0+ (Ventura)
- Xcode 15.0+
- Swift 5.9+

## Features

- ✨ Real-time next-word predictions (<15ms on M1+)
- 🔍 Grammar error detection with AI
- ✍️ AI-powered sentence rewriting
- 🔒 100% offline - no internet required
- 🎯 System-wide integration
- 🚀 Hardware accelerated (Neural Engine)

## License

MIT License
