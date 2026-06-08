import Cocoa
import ApplicationServices

/// Monitors text field focus changes and cursor position using Accessibility API
class AccessibilityMonitor {
    static let shared = AccessibilityMonitor()
    
    private var observer: AXObserver?
    private var runningApp: NSRunningApplication?
    private var isMonitoring = false
    public var isObserverActive: Bool { observer != nil }
    
    // Callback for when focused element changes
    var onFocusChanged: ((AXUIElement, CGPoint?) -> Void)?
    
    // Callback for when text value changes
    var onTextChanged: ((String, AXUIElement) -> Void)?
    
    // The currently active focused text element for coordinate mapping
    public var lastFocusedElement: AXUIElement?
    
    private init() {
        print("🔍 AccessibilityMonitor initialized")
    }
    
    /// Start monitoring focused element changes
    func startMonitoring() {
        guard !isMonitoring else { return }
        
        // Check permission first
        guard PermissionManager.shared.isAccessibilityEnabled else {
            print("❌ Accessibility permission not granted")
            PermissionManager.shared.showPermissionTutorial()
            return
        }
        
        print("👀 Starting accessibility monitoring...")
        isMonitoring = true
        
        // Monitor for app activation changes
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(activeAppChanged(_:)),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )
        
        // Start monitoring current app
        if let frontApp = NSWorkspace.shared.frontmostApplication {
            setupObserver(for: frontApp)
        }
    }
    
    /// Stop monitoring
    func stopMonitoring() {
        guard isMonitoring else { return }
        
        print("🛑 Stopping accessibility monitoring...")
        isMonitoring = false
        
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        
        if let observer = observer {
            CFRunLoopRemoveSource(
                CFRunLoopGetCurrent(),
                AXObserverGetRunLoopSource(observer),
                .defaultMode
            )
        }
        observer = nil
        runningApp = nil
    }
    
    @objc private func activeAppChanged(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let app = userInfo[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
            return
        }
        
        print("📱 Active app changed: \(app.localizedName ?? "Unknown")")
        setupObserver(for: app)
    }
    
    private func setupObserver(for app: NSRunningApplication) {
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        
        // ELECTRON/CHROMIUM HACK: Force enhanced accessibility
        let enhancedAttr = "AXEnhancedUserInterface" as CFString
        AXUIElementSetAttributeValue(appElement, enhancedAttr, kCFBooleanTrue)
        print("🚀 [AccessibilityMonitor] Enabled AXEnhancedUserInterface for \(app.localizedName ?? "Unknown")")
        
        // Remove existing observer
        if let observer = observer {
            CFRunLoopRemoveSource(
                CFRunLoopGetCurrent(),
                AXObserverGetRunLoopSource(observer),
                .defaultMode
            )
        }
        
        runningApp = app
        let pid = app.processIdentifier
        
        // Create observer
        var newObserver: AXObserver?
        let error = AXObserverCreate(pid, observerCallback, &newObserver)
        
        guard error == .success, let observer = newObserver else {
            print("❌ Failed to create AXObserver: \(error.rawValue)")
            return
        }
        
        self.observer = observer
        
        // Get application element
        // Redundant declaration removed as it's now at the top of the function
        
        // Add notifications to observe
        let notifications = [
            kAXFocusedUIElementChangedNotification,
            kAXSelectedTextChangedNotification,
            kAXValueChangedNotification
        ]
        
        for notification in notifications {
            AXObserverAddNotification(observer, appElement, notification as CFString, UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()))
        }
        
        // Add to run loop
        CFRunLoopAddSource(
            CFRunLoopGetCurrent(),
            AXObserverGetRunLoopSource(observer),
            .defaultMode
        )
        
        // PROD: Force accessibility on immediately
        let manualAttr = "AXManualAccessibility" as CFString
        AXUIElementSetAttributeValue(appElement, manualAttr, kCFBooleanTrue)
        AXUIElementSetAttributeValue(appElement, enhancedAttr, kCFBooleanTrue)
        
        print("✅ Observer and 'Prodding' set up for: \(app.localizedName ?? "Unknown")")
        
        // Get current focused element
        checkCurrentFocusedElement(appElement: appElement)
    }
    
    private func checkCurrentFocusedElement(appElement: AXUIElement) {
        var focusedElement: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedElement)
        
        if error == .success, let element = focusedElement {
            let axElement = element as! AXUIElement
            handleFocusedElement(axElement)
        }
    }
    
    /// Convert AX global coordinates to Cocoa screen coordinates (bottom-left)
    private func convertToCocoa(axPoint: CGPoint) -> CGPoint {
        let screens = NSScreen.screens
        let primaryScreen = screens.first { $0.frame.origin == .zero } ?? screens[0]
        let primaryHeight = primaryScreen.frame.height
        return CGPoint(x: axPoint.x, y: primaryHeight - axPoint.y)
    }

    /// Recursively find a descendant that supports text input
    private func findTextElement(in element: AXUIElement, depth: Int = 0) -> AXUIElement? {
        if depth > 25 { return nil } // Increased depth for deep browser DOMs
        
        let role = getRole(element)
        
        // 1. Try nested focus first (most specific and fastest)
        var nestedFocus: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXFocusedUIElementAttribute as CFString, &nestedFocus) == .success {
            let nested = nestedFocus as! AXUIElement
            // Avoid infinite recursion if the element returns itself
            if nested != element {
                if let found = findTextElement(in: nested, depth: depth + 1) {
                    return found
                }
            }
        }

        // 2. Check if this element itself is a text target
        var roleDescription: String = ""
        var roleDescRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXRoleDescriptionAttribute as CFString, &roleDescRef) == .success {
            roleDescription = (roleDescRef as? String) ?? ""
        }
        
        var names: CFArray?
        AXUIElementCopyAttributeNames(element, &names)
        let attributes = (names as? [String]) ?? []

        let isTextRole = role == kAXTextFieldRole || role == kAXTextAreaRole || role == "AXTextField" || role == "AXTextArea" || role == "textbox"
        let isComboBox = role == kAXComboBoxRole || role == "AXComboBox"
        let isStaticText = (role == "AXStaticText" || role == "AXHeading") && (attributes.contains(kAXValueAttribute) || attributes.contains(kAXSelectedTextRangeAttribute))
        let isEditor = roleDescription.lowercased().contains("editor") || roleDescription.lowercased().contains("document") || roleDescription.lowercased().contains("text") || roleDescription.lowercased().contains("field")

        // We accept roles that are clearly text-related OR if they have a selected text range attribute
        // But we EXCLUDE WebArea and some generic containers unless they are precisely what we need
        if (isTextRole || isComboBox || isStaticText || isEditor || attributes.contains(kAXSelectedTextRangeAttribute)) {
             // If it's a Group/WebArea, only accept if it actually has a value or role description indicating it's an editor
             if role == "AXGroup" || role == "AXWebArea" {
                 if !isEditor && !attributes.contains(kAXValueAttribute) && !attributes.contains(kAXSelectedTextRangeAttribute) {
                     return nil
                 }
             }
             
             if role != "AXWebArea" && role != "AXScrollArea" {
                 print("🎯 [AccessibilityMonitor] Identified text target: \(role) (\(roleDescription)) at depth \(depth)")
                 return element
             }
        }
        
        // 3. Drill into children as a last resort
        var children: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success, 
           let childrenArray = children as? [AXUIElement] {
            
            // Limit breadth to avoid O(N!) in massive trees
            // Web areas can have many siblings, but we usually want the one with focused children
            let maxChildren = (role == "AXWebArea") ? 2000 : 200
            let childrenToProcess = childrenArray.prefix(maxChildren)
            
            for child in childrenToProcess {
                if let found = findTextElement(in: child, depth: depth + 1) {
                    return found
                }
            }
        }
        
        return nil
    }

    /// Diagnostic: Dump the UI hierarchy for the targeted window/app
    func dumpHierarchy(start: AXUIElement, depth: Int = 0) {
        let indent = String(repeating: "  ", count: depth)
        let role = getRole(start)
        
        var title: CFTypeRef?
        AXUIElementCopyAttributeValue(start, kAXTitleAttribute as CFString, &title)
        let titleStr = title as? String ?? ""
        
        print("\(indent)📍 [\(role)] \(titleStr)")
        
        if depth > 8 { // Lower limit for dump
            return
        }
        
        var children: CFTypeRef?
        if AXUIElementCopyAttributeValue(start, kAXChildrenAttribute as CFString, &children) == .success,
           let childrenArray = children as? [AXUIElement] {
            for child in childrenArray {
                dumpHierarchy(start: child, depth: depth + 1)
            }
        }
    }

    private func getRole(_ element: AXUIElement) -> String {
        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        return (role as? String) ?? "Unknown"
    }

    func handleFocusedElement(_ element: AXUIElement) {
        let roleString = getRole(element)
        print("🔍 [AccessibilityMonitor] Evaluating focused element: \(roleString)")
        
        // Skip purely structural/ignore-list roles
        // Skip purely structural roles, but allow Toolbar/Group as they often contain text inputs
        let skipRoles = [kAXWindowRole, kAXSheetRole, kAXDrawerRole, kAXSystemWideRole, kAXScrollBarRole, kAXMenuRole, kAXMenuBarRole]
        if skipRoles.contains(roleString) {
            print("⏭️ [AccessibilityMonitor] Skipping structural role: \(roleString)")
            return 
        }

        var targetElement = element
        
        // Always try to drill down to the most specific text element
        if let foundChild = findTextElement(in: element) {
            if foundChild != element {
                print("🎯 Discovered deeper text element inside \(roleString) -> \(getRole(foundChild))")
                targetElement = foundChild
            }
        }
        
        if self.lastFocusedElement != targetElement {
            self.lastFocusedElement = targetElement
            self.lastKnownText = "" // Clear text cache when element changes
            print("🎯 Focus element changed to \(getRole(targetElement)). Clearing lastKnownText.")
        }

        // Check if the target supports text manipulation
        var names: CFArray?
        AXUIElementCopyAttributeNames(targetElement, &names)
        let attributes = (names as? [String]) ?? []
        
        let hasTextSupport = attributes.contains(kAXSelectedTextRangeAttribute) || attributes.contains(kAXValueAttribute)
        
        if hasTextSupport {
            let finalRole = getRole(targetElement)
            print("📝 [AccessibilityMonitor] Text-ready element focused: \(finalRole) (Attrs: \(attributes.count))")
            
            // Log names of attributes for better debugging
            if attributes.count < 15 {
                print("📝 [AccessibilityMonitor] Attrs: \(attributes.joined(separator: ", "))")
            }
            
            // Check for browser field bounds first (Overlay UI)
            let browserState = CursorTracker.shared.getBrowserState(element: targetElement)
            
            if let fieldRect = browserState.fieldBounds {
                print("🖼️ Showing overlay at \(fieldRect)")
                DispatchQueue.main.async {
                    OverlayWindowController.shared.show(at: fieldRect)
                }
            } else {
                // Log for debugging: what is the AX position of our target?
                var pVal: CFTypeRef?
                if AXUIElementCopyAttributeValue(targetElement, kAXPositionAttribute as CFString, &pVal) == .success {
                    var point = CGPoint.zero
                    AXValueGetValue(pVal as! AXValue, .cgPoint, &point)
                    print("📍 [AccessibilityMonitor] Target \(getRole(targetElement)) AX Position: \(point)")
                }
                
                DispatchQueue.main.async {
                    OverlayWindowController.shared.hide()
                }
            }
            
            // Use CursorTracker to get position (handles fallbacks for browser/Chrome)
            if let position = browserState.cursorPoint ?? CursorTracker.shared.getCursorPosition(from: targetElement) {
                // Initial creation might return (0,0) before layout is ready
                // But CursorTracker now handles most invalid cases
                onFocusChanged?(targetElement, position)
            } else {
                onFocusChanged?(targetElement, nil)
            }
        } else {
            print("⏭️ Skipping element: \(roleString) (Attrs: \(attributes.count))")
            DispatchQueue.main.async {
                OverlayWindowController.shared.hide()
            }
        }
    }
    
    public var lastKnownText = ""
    
    func handleTextChange(_ element: AXUIElement) {
        var value: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)
        
        if let text = value as? String {
            // Only process if we have actual text and it's different from last time
            guard !text.isEmpty else {
                print("📝 Text update skipped: empty")
                return
            }
            
            // Avoid duplicate processing
            guard text != lastKnownText else {
                return
            }
            
            lastKnownText = text
            print("✏️ [AccessibilityMonitor] Text changed in \(getRole(element)): \"\(text.suffix(50))...\" (len: \(text.count))")
            onTextChanged?(text, element)
        }
    }
    
    func handleSelectionChange(_ element: AXUIElement) {
        // Selection changes update cursor position
        if CursorTracker.shared.getCursorPosition(from: element) != nil {
            CursorTracker.shared.updateCursorPosition()
        }
        
        // Get the selected range
        var selectedRange: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &selectedRange) == .success {
            var range = CFRange()
            if AXValueGetValue(selectedRange as! AXValue, .cfRange, &range) {
                let nsRange = NSRange(location: range.location, length: range.length)
                
                // Get the text to show what's selected
                var text = ""
                var selectedText: CFTypeRef?
                if AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &selectedText) == .success {
                    text = (selectedText as? String) ?? ""
                }
                
                print("🎯 Selection changed: range=(\(nsRange.location), \(nsRange.length)) text=\"\(text)\"")
                onSelectionChanged?(text, nsRange, element)
            }
        }
    }
    
    // Callback for when selection changes: (text, range, element)
    var onSelectionChanged: ((String, NSRange, AXUIElement) -> Void)?
    

    
    // MARK: - Grammarly-Style Active Text Reading
    
    /// Proactively read text from the currently focused element (Grammarly approach)
    /// Unlike AXObserver notifications which many apps don't fire reliably,
    /// this actively polls the focused element after each keystroke
    func readFocusedElementText() -> (text: String, element: AXUIElement)? {
        // Try System-Wide first
        let systemWide = AXUIElementCreateSystemWide()
        var focusedElement: CFTypeRef?
        var focusError = AXUIElementCopyAttributeValue(
            systemWide,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElement
        )
        
        // 2. If system-wide fails, try the frontmost application directly
        if focusError != .success, let frontApp = NSWorkspace.shared.frontmostApplication {
            let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)
            
            // PROD: Ask directly without the heavy retry/sleep loop in the event path
            // If Chrome is asleep, we'll catch it in the background or on the next keypress
            focusError = AXUIElementCopyAttributeValue(
                appElement,
                kAXFocusedUIElementAttribute as CFString,
                &focusedElement
            )
            
            if focusError != .success || focusedElement == nil {
                // Try to get focused element from the Focused Window attribute (faster than window iteration)
                var focusedWindowRef: CFTypeRef?
                if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedWindowRef) == .success {
                    let windowElement = focusedWindowRef as! AXUIElement
                    focusError = AXUIElementCopyAttributeValue(
                        windowElement,
                        kAXFocusedUIElementAttribute as CFString,
                        &focusedElement
                    )
                }
            }
        }
        
        guard focusError == .success, let element = focusedElement else {
            return nil
        }
        
        var axElement = element as! AXUIElement
        
        // Identifying the element role
        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(axElement, kAXRoleAttribute as CFString, &role)
        let roleString = (role as? String) ?? "Unknown"
        
        // CHROMIUM FIX: Use the robust recursive finder to drill down
        if let foundElement = findTextElement(in: axElement) {
            axElement = foundElement
            AXUIElementCopyAttributeValue(axElement, kAXRoleAttribute as CFString, &role)
        }
        
        let finalRole = (role as? String) ?? roleString
        
        // SYNC: Ensure we update our tracker so DiagnosticService knows we have the REFINED focus
        let currentFocus = self.lastFocusedElement
        if currentFocus == nil || !CFEqual(currentFocus!, axElement) {
            self.lastFocusedElement = axElement
        }
        
        print("🎯 Focused Element Identified: \(finalRole)")
        
        // 2. Read the text value (try multiple attributes)
        let attributesToTry = [kAXValueAttribute, kAXSelectedTextAttribute, kAXDescriptionAttribute]
        var textValue: String?
        
        for attr in attributesToTry {
            var value: CFTypeRef?
            if AXUIElementCopyAttributeValue(axElement, attr as CFString, &value) == .success {
                if let text = value as? String, !text.isEmpty {
                    textValue = text
                    break
                }
            }
        }
        
        // Roles that typically contain text
        let textRoles = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, "AXStaticText", "AXWebArea", "AXTextField"]
        
        if let text = textValue {
            return (text: text, element: axElement)
        } else if textRoles.contains(where: { finalRole.contains($0) }) {
            // It's a text element but empty
            return (text: "", element: axElement)
        }
        
        return nil
    }
    
    /// Get the screen coordinates for a given text range in an element
    func getBoundsForRange(range: NSRange, element: AXUIElement) -> CGRect? {
        let cfRange = CFRange(location: range.location, length: range.length)
        guard let axRange = AXValueCreate(.cfRange, [cfRange]) else { return nil }
        
        var bounds: CFTypeRef?
        let error = AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXBoundsForRangeParameterizedAttribute as CFString,
            axRange,
            &bounds
        )
        
        if error == .success, let boundsValue = bounds {
            var rect = CGRect.zero
            if AXValueGetValue(boundsValue as! AXValue, .cgRect, &rect) {
                let bottomLeft = convertToCocoa(axPoint: CGPoint(x: rect.origin.x, y: rect.origin.y + rect.height))
                return CGRect(origin: bottomLeft, size: rect.size)
            }
        }
        
        // Fallback: If bounds for range fails, try to at least get the element's overall bounds
        var position = CGPoint.zero
        var size = CGSize.zero
        var posValue: CFTypeRef?
        var sizeValue: CFTypeRef?
        
        if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posValue) == .success,
           AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success {
            if AXValueGetValue(posValue as! AXValue, .cgPoint, &position) &&
               AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) {
                let bottomLeft = convertToCocoa(axPoint: CGPoint(x: position.x, y: position.y + size.height))
                return CGRect(origin: bottomLeft, size: size)
            }
        }
        
        return nil
    }
    
    /// Get a semi-stable ID for a UI element (useful for tracking window focus)
    func getElementID(_ element: AXUIElement) -> Int64 {
        var pid: pid_t = 0
        AXUIElementGetPid(element, &pid)
        
        // Combine PID with the element's hash or address for a unique-ish ID
        let hash = Int64(bitPattern: UInt64(UInt(bitPattern: Unmanaged.passUnretained(element).toOpaque())))
        return (Int64(pid) << 32) | (hash & 0xFFFFFFFF)
    }

    /// Manually force accessibility features on the frontmost app
    func forceWakeAccessibility() {
        guard let app = NSWorkspace.shared.frontmostApplication else { return }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        
        let manualAttr = "AXManualAccessibility" as CFString
        let enhancedAttr = "AXEnhancedUserInterface" as CFString
        
        AXUIElementSetAttributeValue(appElement, manualAttr, kCFBooleanTrue)
        AXUIElementSetAttributeValue(appElement, enhancedAttr, kCFBooleanTrue)
        
        print("💥 Force-woke accessibility for: \(app.localizedName ?? "Unknown")")
        
        // Re-setup observer to be sure
        setupObserver(for: app)
    }
}

// C callback for AXObserver
private func observerCallback(
    observer: AXObserver,
    element: AXUIElement,
    notification: CFString,
    refcon: UnsafeMutableRawPointer?
) {
    guard let refcon = refcon else { return }
    
    let monitor = Unmanaged<AccessibilityMonitor>.fromOpaque(refcon).takeUnretainedValue()
    
    let notificationName = notification as String
    
    switch notificationName {
    case kAXFocusedUIElementChangedNotification:
        monitor.handleFocusedElement(element)
        
    case kAXValueChangedNotification:
        // Text value actually changed - process it
        monitor.handleTextChange(element)
        
    case kAXSelectedTextChangedNotification:
        // Selection/cursor moved
        monitor.handleSelectionChange(element)
        // CRITICAL: Some apps (Chrome, etc.) don't always fire ValueChanged when typing.
        // If the selection changed, the text likely did too. Check it.
        monitor.handleTextChange(element)
        
    default:
        print("📢 Notification: \(notificationName)")
    }
}
import Cocoa
import ApplicationServices

/// Tracks cursor position and manages popover placement
class CursorTracker {
    static let shared = CursorTracker()
    
    private var currentElement: AXUIElement?
    private var lastKnownPosition: CGPoint?
    public var lastKnownOffset: Int = 0
    
    // Callback when cursor position updates
    var onCursorPositionChanged: ((CGPoint) -> Void)?
    
    private init() {
        print("📍 CursorTracker initialized")
    }
    
    /// Update tracked element
    func trackElement(_ element: AXUIElement) {
        currentElement = element
        updateCursorPosition()
    }
    
    /// Get current cursor position
    func getCurrentPosition() -> CGPoint? {
        guard let element = currentElement else { return lastKnownPosition }
        return getCursorPosition(from: element)
    }
    
    /// Update cursor position and notify listeners
    func updateCursorPosition() {
        guard let element = currentElement,
              let position = getCursorPosition(from: element) else {
            return
        }
        
        lastKnownPosition = position
        onCursorPositionChanged?(position)
    }
    
    /// Convert AX global coordinates (top-left) to Cocoa screen coordinates (bottom-left)
    func convertToCocoa(axPoint: CGPoint) -> CGPoint {
        let screens = NSScreen.screens
        // The primary screen (origin 0,0) defines the global AX coordinate space origin (top-left).
        let primaryScreen = screens.first { $0.frame.origin == .zero } ?? screens[0]
        let primaryHeight = primaryScreen.frame.height
        
        // 1. Convert to a "Global Cocoa" coordinate system (origin bottom-left of primary screen)
        let cocoaY = primaryHeight - axPoint.y
        let globalCocoaPoint = CGPoint(x: axPoint.x, y: cocoaY)
        
        return globalCocoaPoint
    }
    
    /// Get cursor position from element
    func getCursorPosition(from element: AXUIElement) -> CGPoint? {
        let targetElement = findLeafElement(from: element)
        let role = getRole(targetElement)
        
        // Try Method 1: Get cursor position from selected text range bounds
        var selectedRange: CFTypeRef?
        let rangeError = AXUIElementCopyAttributeValue(
            targetElement,
            kAXSelectedTextRangeAttribute as CFString,
            &selectedRange
        )
        
        if rangeError == .success, let range = selectedRange {
            var bounds: CFTypeRef?
            let boundsError = AXUIElementCopyParameterizedAttributeValue(
                targetElement,
                kAXBoundsForRangeParameterizedAttribute as CFString,
                range,
                &bounds
            )
            
            if boundsError == .success, let boundsValue = bounds {
                var rect = CGRect.zero
                if AXValueGetValue(boundsValue as! AXValue, .cgRect, &rect) {
                    
                    // 1. Check for basic invalidity
                    let isDegenerate = rect.origin.x <= 0 && rect.origin.y <= 0
                    let isEmpty = rect.width == 0 && rect.height == 0
                    
                    // 2. Cross-verify with element's actual screen position
                    var elementPos: CFTypeRef?
                    var elementPoint = CGPoint.zero
                    if AXUIElementCopyAttributeValue(targetElement, kAXPositionAttribute as CFString, &elementPos) == .success {
                        AXValueGetValue(elementPos as! AXValue, .cgPoint, &elementPoint)
                    }
                    
                    // If the found point is wildly different vertically (> 300px), it's likely bogus Chromium reporting
                    let tooFar = elementPoint != .zero && abs(rect.origin.y - elementPoint.y) > 300
                    
                    if isDegenerate || isEmpty || tooFar {
                        if tooFar { print("⚠️ [CursorTracker] Method 1 returned bogus distant focus: \(rect.origin) vs Element: \(elementPoint). Falling back...") }
                        else { print("⚠️ [CursorTracker] Range bounds invalid (Pos:\(rect.origin), Size:\(rect.size)) for \(role), trying browser fallback...") }
                        
                        // Try DOM-based fallback
                        if let browserPoint = tryBrowserFallback(element: targetElement) {
                            return browserPoint
                        }
                    } else {
                        let finalPoint = convertToCocoa(axPoint: rect.origin)
                        print("📍 [Method 1] AX: \(rect.origin) -> Cocoa: \(finalPoint) | Rect: \(rect.size)")
                        return finalPoint
                    }
                }
            }
        }
        
        // Method 2: Estimate position based on insertion point
        var anchorPoint = CGPoint.zero
        var foundRole = "None"
        
        // 1. Try the element itself first
        var posVal: CFTypeRef?
        if AXUIElementCopyAttributeValue(targetElement, kAXPositionAttribute as CFString, &posVal) == .success {
            AXValueGetValue(posVal as! AXValue, .cgPoint, &anchorPoint)
            foundRole = getRole(targetElement)
        }
        
        // 2. If element is (0,0), climb up to find a stable ancestor with a real position
        if anchorPoint == .zero || (anchorPoint.x < 1 && anchorPoint.y < 1) {
            var parent = targetElement
            while true {
                var parentRef: CFTypeRef?
                if AXUIElementCopyAttributeValue(parent, kAXParentAttribute as CFString, &parentRef) == .success {
                    parent = parentRef as! AXUIElement
                    if AXUIElementCopyAttributeValue(parent, kAXPositionAttribute as CFString, &posVal) == .success {
                        AXValueGetValue(posVal as! AXValue, .cgPoint, &anchorPoint)
                        if anchorPoint != .zero && (anchorPoint.x > 1 || anchorPoint.y > 1) {
                            foundRole = getRole(parent)
                            break
                        }
                    }
                } else { break }
                
                // Don't go above window
                if getRole(parent) == kAXWindowRole { break }
            }
        }
        
        // 3. Last resort: Use mouse position as the anchor
        if anchorPoint == .zero || (anchorPoint.x < 1 && anchorPoint.y < 1) {
            let mouseLoc = NSEvent.mouseLocation
            // Cocoa (bottom-left) to AX (top-left) conversion
            let screens = NSScreen.screens
            let primaryScreen = screens.first { $0.frame.origin == .zero } ?? screens[0]
            anchorPoint = CGPoint(x: mouseLoc.x, y: primaryScreen.frame.height - mouseLoc.y)
            foundRole = "MouseProxy"
            print("🖱️ [Method 2] No stable AX anchor, using mouse as proxy: \(anchorPoint)")
        }
        
        var textRef: CFTypeRef?
        AXUIElementCopyAttributeValue(targetElement, kAXValueAttribute as CFString, &textRef)
        let text = (textRef as? String) ?? ""
        
        var insertionPoint: Int = text.count
        if let rangeValue = selectedRange {
            var cfRange = CFRange()
            if AXValueGetValue(rangeValue as! AXValue, .cfRange, &cfRange) {
                insertionPoint = cfRange.location
                lastKnownOffset = cfRange.location
            }
        }
        
        if anchorPoint != .zero {
            let charWidth: CGFloat = 8.5
            let lineHeight: CGFloat = 22.0
            
            let textBeforeCursor = String(text.prefix(insertionPoint))
            let lines = textBeforeCursor.components(separatedBy: "\n")
            let currentLineText = lines.last ?? ""
            let tabExpandedText = currentLineText.replacingOccurrences(of: "\t", with: "    ")
            
            let lineNumber = lines.count - 1
            let posInLine = tabExpandedText.count
            
            // Adjust offsets based on what anchor we found
            var xOffset: CGFloat = 0
            var yOffset: CGFloat = 0
            
            if foundRole == "AXWebArea" || foundRole == kAXWindowRole || foundRole == "MouseProxy" {
                // Approximate offsets if we are at a high-level container or mouse
                xOffset = 20
                yOffset = foundRole == "MouseProxy" ? -10 : 40 
            }
            
            let axX = anchorPoint.x + xOffset + CGFloat(posInLine) * charWidth
            let axY = anchorPoint.y + yOffset + CGFloat(lineNumber) * lineHeight
            
            let finalPoint = convertToCocoa(axPoint: CGPoint(x: axX, y: axY))
            print("📍 [Method 2] Estimated (Anchor:\(foundRole)): AX(\(Int(axX)), \(Int(axY))) -> Cocoa: \(finalPoint)")
            
            return finalPoint
        }
        
        // Method 3: Mouse fallback
        let mouseLocation = NSEvent.mouseLocation
        print("📍 [Method 3] Mouse Fallback: \(mouseLocation)")
        return mouseLocation
    }
    
    /// Calculate optimal popover position (above cursor, avoiding screen edges)
    func calculatePopoverPosition(cursorPosition: CGPoint, popoverSize: CGSize) -> CGPoint {
        // Find the screen containing the cursor
        let screens = NSScreen.screens
        let targetScreen = screens.first { NSMouseInRect(cursorPosition, $0.frame, false) } ?? NSScreen.main ?? screens[0]
        
        let screenFrame = targetScreen.visibleFrame
        print("🖥️ Target Screen: \(targetScreen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] ?? "unknown") | Frame: \(targetScreen.frame) | Visible: \(screenFrame)")
        
        let padding: CGFloat = 4
        
        // Start with position above cursor
        var x = cursorPosition.x - (popoverSize.width / 2)
        var y = cursorPosition.y + padding
        
        // Adjust X if going off-screen (on the current screen)
        if x < screenFrame.minX {
            x = screenFrame.minX + padding
        } else if x + popoverSize.width > screenFrame.maxX {
            x = screenFrame.maxX - popoverSize.width - padding
        }
        
        // Adjust Y if going off top of screen - show below cursor instead
        if y + popoverSize.height > screenFrame.maxY {
            y = cursorPosition.y - popoverSize.height - padding/2
        }
        
        // Safety clamp: ensure it stays within the visible area of the target screen
        y = max(y, screenFrame.minY + padding)
        y = min(y, screenFrame.maxY - popoverSize.height - padding)
        
        return CGPoint(x: x, y: y)
    }
    
    // MARK: - Helpers
    
    private func findLeafElement(from element: AXUIElement) -> AXUIElement {
        // Try to get focused sub-element first (Chromium/Web content leaf targeting)
        var focused: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXFocusedUIElementAttribute as CFString, &focused) == .success {
            let nested = focused as! AXUIElement
            if nested != element {
                return findLeafElement(from: nested)
            }
        }
        
        // If it's a known text role, it's a good candidate for direct bounds querying
        let role = getRole(element)
        if ["AXTextField", "AXTextArea", "AXStaticText", "AXComboBox", "AXTextField"].contains(role) {
            return element
        }
        
        return element
    }
    

    // MARK: - Browser Integration (DOM-like Precision)
    
    struct BrowserCursorResult {
        let cursorPoint: CGPoint?
        let fieldBounds: CGRect?
    }

    /// Helper to try and get browser DOM coordinates if AX fails
    /// Now returns both cursor point and field bounds if available
    func getBrowserState(element: AXUIElement) -> BrowserCursorResult {
        // 1. Identify if this is Chrome
        let app = NSRunningApplication(processIdentifier: pid(for: element))
        let appName = app?.localizedName ?? ""
        
        if appName == "Google Chrome" {
            // 2. Execute AppleScript to get DOM rects
            if let result = BrowserConnector.shared.getBrowserState(appName: appName) {
                
                // Get window position from AX (reused logic)
                var window = element
                while getRole(window) != kAXWindowRole {
                    var parent: CFTypeRef?
                    if AXUIElementCopyAttributeValue(window, kAXParentAttribute as CFString, &parent) == .success {
                        window = parent as! AXUIElement
                    } else {
                        break
                    }
                }
                
                var windowPos = CGPoint.zero
                var posValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &posValue) == .success {
                     AXValueGetValue(posValue as! AXValue, .cgPoint, &windowPos)
                }
                
                // Find WebArea
                var webArea = element
                while getRole(webArea) != "AXWebArea" && getRole(webArea) != kAXWindowRole {
                    var parent: CFTypeRef?
                    if AXUIElementCopyAttributeValue(webArea, kAXParentAttribute as CFString, &parent) == .success {
                        webArea = parent as! AXUIElement
                    } else {
                        break
                    }
                }
                
                if getRole(webArea) == "AXWebArea" {
                    var webAreaPos = CGPoint.zero
                    if AXUIElementCopyAttributeValue(webArea, kAXPositionAttribute as CFString, &posValue) == .success {
                        AXValueGetValue(posValue as! AXValue, .cgPoint, &webAreaPos)
                        
                        var finalCursor: CGPoint? = nil
                        var finalField: CGRect? = nil
                        
                        // Convert cursor rect
                        if let domCursor = result.cursorFrame {
                            let screenX = webAreaPos.x + domCursor.origin.x
                            let screenY = webAreaPos.y + domCursor.origin.y
                            // Convert to Cocoa (bottom-left origin)
                            finalCursor = convertToCocoa(axPoint: CGPoint(x: screenX, y: screenY + domCursor.height))
                        }
                        
                        // Convert field rect
                        if let domField = result.fieldFrame {
                             let fieldScreenX = webAreaPos.x + domField.origin.x
                             let fieldScreenY = webAreaPos.y + domField.origin.y
                             
                             // Convert rect to Cocoa
                             // Cocoa Y is bottom-left. AX Y is top-left.
                             // AX Top-Left of rect: (fieldScreenX, fieldScreenY)
                             // Cocoa Bottom-Left of rect:
                             // First convert top-left to Cocoa:
                             let cocoaTopLeft = convertToCocoa(axPoint: CGPoint(x: fieldScreenX, y: fieldScreenY))
                             // Cocoa rect origin (bottom-left) is cocoaTopLeft.y - height
                             let cocoaOriginY = cocoaTopLeft.y - domField.height
                             
                             finalField = CGRect(x: cocoaTopLeft.x, y: cocoaOriginY, width: domField.width, height: domField.height)
                        }
                        
                        return BrowserCursorResult(cursorPoint: finalCursor, fieldBounds: finalField)
                    }
                }
            }
        }
        return BrowserCursorResult(cursorPoint: nil, fieldBounds: nil)
    }

    private func tryBrowserFallback(element: AXUIElement) -> CGPoint? {
        return getBrowserState(element: element).cursorPoint
    }

    private func pid(for element: AXUIElement) -> pid_t {
        var pid: pid_t = 0
        AXUIElementGetPid(element, &pid)
        return pid
    }
    
    private func getRole(_ element: AXUIElement) -> String {
        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        return (role as? String) ?? "Unknown"
    }
    
    /// Returns the screen bounds for multiple ranges within an element
    func getBounds(for ranges: [NSRange], in element: AXUIElement) -> [NSRect] {
        var rects: [NSRect] = []
        
        for range in ranges {
            var axRange = CFRange(location: range.location, length: range.length)
            let rangeValue = AXValueCreate(.cfRange, &axRange)
            
            var bounds: CFTypeRef?
            let error = AXUIElementCopyParameterizedAttributeValue(
                element,
                kAXBoundsForRangeParameterizedAttribute as CFString,
                rangeValue!,
                &bounds
            )
            
            if error == .success, let boundsValue = bounds {
                var rect = CGRect.zero
                if AXValueGetValue(boundsValue as! AXValue, .cgRect, &rect) {
                    // Convert AX top-left origin to Cocoa bottom-left
                    let cocoaOrigin = convertToCocoa(axPoint: rect.origin)
                    
                    // Note: convertToCocoa returns the bottom-left of the point.
                    // For a rect, we need to adjust by the height if we want the bottom-left of the RECT.
                    let finalOrigin = CGPoint(x: cocoaOrigin.x, y: cocoaOrigin.y - rect.height)
                    rects.append(NSRect(origin: finalOrigin, size: rect.size))
                }
            }
        }
        
        return rects
    }
}

import SwiftUI

class CorrectionViewModel: ObservableObject {
    @Published var originalText: String = ""
    @Published var suggestion: String = ""
    @Published var explanation: String = ""
    @Published var isVisible: Bool = false
    
    var onApply: (() -> Void)?
    
    func apply() {
        onApply?()
    }
}

struct CorrectionBubbleView: View {
    @ObservedObject var viewModel: CorrectionViewModel
    
    @State private var isHovered = false
    
    var body: some View {
        Group {
            if viewModel.isVisible {
                Button(action: {
                    withAnimation {
                        viewModel.isVisible = false
                    }
                    viewModel.apply()
                }) {
                    HStack(spacing: 8) {
                        Text(viewModel.suggestion)
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .foregroundColor(.white)
                        
                        Image(systemName: "arrow.right.circle.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(
                        Capsule()
                            .fill(LinearGradient(colors: [Color.purple, Color.blue], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .shadow(color: Color.black.opacity(0.2), radius: 4, x: 0, y: 2)
                    )
                    .overlay(
                        Capsule()
                            .stroke(Color.white.opacity(0.2), lineWidth: 1)
                    )
                }
                .buttonStyle(PlainButtonStyle())
                .scaleEffect(isHovered ? 1.05 : 1.0)
                .onHover { hovering in
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                        isHovered = hovering
                    }
                }
                .transition(.asymmetric(
                    insertion: .move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.9)),
                    removal: .opacity.combined(with: .scale(scale: 0.8))
                ))
            }
        }
    }
}


// Window Controller for the correction bubble
class CorrectionBubbleWindowController: NSWindowController {
    static let shared = CorrectionBubbleWindowController()
    
    private let viewModel = CorrectionViewModel()
    
    private init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 220, height: 100),
            styleMask: [.borderless, .nonactivatingPanel], // Non-activating to avoid stealing focus
            backing: .buffered,
            defer: false
        )
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        
        super.init(window: window)
        
        // Initialize content view once
        let contentView = CorrectionBubbleView(viewModel: viewModel)
        let hostingView = NSHostingView(rootView: contentView)
        window.contentView = hostingView
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    func show(at point: CGPoint, original: String, suggestion: String, explanation: String, onApply: @escaping () -> Void) {
        // Update model instead of replacing view
        viewModel.originalText = original
        viewModel.suggestion = suggestion
        viewModel.explanation = explanation
        viewModel.onApply = { [weak self] in
            onApply()
            self?.close()
        }
        
        withAnimation {
            viewModel.isVisible = true
        }
        
        // Offset to show above the text
        let offsetPoint = CGPoint(x: point.x - 100, y: point.y + 10)
        
        // SAFETY: Don't show at (0,0) or bogus top-left coords
        guard offsetPoint.x > 0 && offsetPoint.y > 0 else {
            print("⏭️ Skipping Correction Bubble show: Bogus coordinate \(offsetPoint)")
            return
        }
        
        self.window?.setFrameOrigin(offsetPoint)
        
        // Resize window to fit content if possible, or use fixed large bounds
        // For now, keep fixed bounds as NSHostingView handles subview layout
        
        self.window?.orderFront(nil) // Do NOT steal focus
    }
    
    override func close() {
        viewModel.isVisible = false
        super.close()
    }
}
import Cocoa
import SwiftUI

class SquiggleViewModel: ObservableObject {
    @Published var squiggles: [CorrectionOverlayWindow.SquiggleInfo] = []
}

/// A transparent, click-through overlay window for rendering global squiggly lines
class CorrectionOverlayWindow: NSWindow {
    static let shared = CorrectionOverlayWindow()
    
    public var squiggles: [SquiggleInfo] {
        get { viewModel.squiggles }
    }
    
    private let viewModel = SquiggleViewModel()
    private var linkedWindowID: Int64? = nil
    
    struct SquiggleInfo: Identifiable {
        let id = UUID()
        let rect: NSRect
        let color: Color
        let error: GrammarError // Link to the original error
    }
    
    private init() {
        super.init(
            contentRect: NSScreen.main?.frame ?? .zero,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        
        self.backgroundColor = .clear
        self.isOpaque = false
        self.hasShadow = false
        self.level = .statusBar // Above almost everything
        self.ignoresMouseEvents = true // Click-through by default
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        
        // Initialize content view once
        let view = SquiggleOverlayView(viewModel: viewModel)
        self.contentView = NSHostingView(rootView: view)
    }
    
    func updateSquiggles(_ newSquiggles: [SquiggleInfo]) {
        // Update model instead of replacing view
        viewModel.squiggles = newSquiggles
        
        if !newSquiggles.isEmpty {
            self.orderFront(nil)
        } else {
            self.orderOut(nil)
        }
    }
    
    func findSquiggle(near point: CGPoint) -> SquiggleInfo? {
        let threshold: CGFloat = 10.0
        return viewModel.squiggles.first { squiggle in
            let expandedRect = squiggle.rect.insetBy(dx: -threshold, dy: -threshold)
            return expandedRect.contains(point)
        }
    }
    
    func clear() {
        self.linkedWindowID = nil
        updateSquiggles([])
    }
    
    /// Clear squiggles if we've switched to a different window/context
    func checkWindowConsistency(for element: AXUIElement) {
        var windowRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &windowRef) == .success {
            let windowEl = windowRef as! AXUIElement
            let currentWindowID = AccessibilityMonitor.shared.getElementID(windowEl)
            
            if let linkedID = self.linkedWindowID, linkedID != currentWindowID {
                print("🪟 Window Switch Detected (\(linkedID) -> \(currentWindowID)). Clearing squiggles.")
                clear()
            }
        }
    }
    
    /// Convert fresh grammar errors into visible squiggly lines
    func updateErrors(_ errors: [GrammarError], in element: AXUIElement? = nil) {
        guard let currentText = AccessibilityMonitor.shared.lastKnownText.isEmpty ? nil : AccessibilityMonitor.shared.lastKnownText else {
            clear()
            return
        }
        
        // If we don't have an element passed, try to get the current focused one
        let targetElement = element ?? AccessibilityMonitor.shared.lastFocusedElement
        
        // Track the window ID this error belongs to
        if let el = targetElement {
            var windowRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXWindowAttribute as CFString, &windowRef) == .success {
                let windowEl = windowRef as! AXUIElement
                self.linkedWindowID = AccessibilityMonitor.shared.getElementID(windowEl)
            }
        }
        
        var newSquiggles: [SquiggleInfo] = []
        
        for error in errors {
            // Range is already NSRange
            let nsRange = error.range
            
            if let element = targetElement,
               let bounds = AccessibilityMonitor.shared.getBoundsForRange(range: nsRange, element: element) {
                
                let color: Color = (error.type == .spelling) ? .red : .orange
                newSquiggles.append(SquiggleInfo(rect: bounds, color: color, error: error))
            }
        }
        
        print("🎨 Updating Overlay: \(newSquiggles.count) squiggles created")
        updateSquiggles(newSquiggles)
    }
}

struct SquiggleOverlayView: View {
    @ObservedObject var viewModel: SquiggleViewModel
    
    var body: some View {
        ZStack {
            Color.clear
            
            ForEach(viewModel.squiggles) { squiggle in
                SquiggleLine(rect: squiggle.rect)
                    .stroke(squiggle.color, lineWidth: 1.5)
            }
        }
        .edgesIgnoringSafeArea(.all)
    }
}

struct SquiggleLine: Shape {
    let rect: NSRect
    
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let y = self.rect.minY // Draw at the bottom of the range in Cocoa (bottom-left)
        let step: CGFloat = 2.0
        let amplitude: CGFloat = 1.0
        
        path.move(to: CGPoint(x: self.rect.minX, y: y))
        
        var x = self.rect.minX
        var phase = 0.0
        
        while x < self.rect.maxX {
            x += step
            let currentY = y + sin(phase) * amplitude
            path.addLine(to: CGPoint(x: x, y: currentY))
            phase += 1.0
        }
        
        return path
    }
}
import Cocoa
import ApplicationServices

/// Monitors text field focus changes and cursor position using Accessibility API
class AccessibilityMonitor {
    static let shared = AccessibilityMonitor()
    
    private var observer: AXObserver?
    private var runningApp: NSRunningApplication?
    private var isMonitoring = false
    public var isObserverActive: Bool { observer != nil }
    
    // Callback for when focused element changes
    var onFocusChanged: ((AXUIElement, CGPoint?) -> Void)?
    
    // Callback for when text value changes
    var onTextChanged: ((String, AXUIElement) -> Void)?
    
    // The currently active focused text element for coordinate mapping
    public var lastFocusedElement: AXUIElement?
    
    private init() {
        print("🔍 AccessibilityMonitor initialized")
    }
    
    /// Start monitoring focused element changes
    func startMonitoring() {
        guard !isMonitoring else { return }
        
        // Check permission first
        guard PermissionManager.shared.isAccessibilityEnabled else {
            print("❌ Accessibility permission not granted")
            PermissionManager.shared.showPermissionTutorial()
            return
        }
        
        print("👀 Starting accessibility monitoring...")
        isMonitoring = true
        
        // Monitor for app activation changes
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(activeAppChanged(_:)),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )
        
        // Start monitoring current app
        if let frontApp = NSWorkspace.shared.frontmostApplication {
            setupObserver(for: frontApp)
        }
    }
    
    /// Stop monitoring
    func stopMonitoring() {
        guard isMonitoring else { return }
        
        print("🛑 Stopping accessibility monitoring...")
        isMonitoring = false
        
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        
        if let observer = observer {
            CFRunLoopRemoveSource(
                CFRunLoopGetCurrent(),
                AXObserverGetRunLoopSource(observer),
                .defaultMode
            )
        }
        observer = nil
        runningApp = nil
    }
    
    @objc private func activeAppChanged(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let app = userInfo[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
            return
        }
        
        print("📱 Active app changed: \(app.localizedName ?? "Unknown")")
        setupObserver(for: app)
    }
    
    private func setupObserver(for app: NSRunningApplication) {
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        
        // ELECTRON/CHROMIUM HACK: Force enhanced accessibility
        let enhancedAttr = "AXEnhancedUserInterface" as CFString
        AXUIElementSetAttributeValue(appElement, enhancedAttr, kCFBooleanTrue)
        print("🚀 [AccessibilityMonitor] Enabled AXEnhancedUserInterface for \(app.localizedName ?? "Unknown")")
        
        // Remove existing observer
        if let observer = observer {
            CFRunLoopRemoveSource(
                CFRunLoopGetCurrent(),
                AXObserverGetRunLoopSource(observer),
                .defaultMode
            )
        }
        
        runningApp = app
        let pid = app.processIdentifier
        
        // Create observer
        var newObserver: AXObserver?
        let error = AXObserverCreate(pid, observerCallback, &newObserver)
        
        guard error == .success, let observer = newObserver else {
            print("❌ Failed to create AXObserver: \(error.rawValue)")
            return
        }
        
        self.observer = observer
        
        // Get application element
        // Redundant declaration removed as it's now at the top of the function
        
        // Add notifications to observe
        let notifications = [
            kAXFocusedUIElementChangedNotification,
            kAXSelectedTextChangedNotification,
            kAXValueChangedNotification
        ]
        
        for notification in notifications {
            AXObserverAddNotification(observer, appElement, notification as CFString, UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()))
        }
        
        // Add to run loop
        CFRunLoopAddSource(
            CFRunLoopGetCurrent(),
            AXObserverGetRunLoopSource(observer),
            .defaultMode
        )
        
        // PROD: Force accessibility on immediately
        let manualAttr = "AXManualAccessibility" as CFString
        AXUIElementSetAttributeValue(appElement, manualAttr, kCFBooleanTrue)
        AXUIElementSetAttributeValue(appElement, enhancedAttr, kCFBooleanTrue)
        
        print("✅ Observer and 'Prodding' set up for: \(app.localizedName ?? "Unknown")")
        
        // Get current focused element
        checkCurrentFocusedElement(appElement: appElement)
    }
    
    private func checkCurrentFocusedElement(appElement: AXUIElement) {
        var focusedElement: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedElement)
        
        if error == .success, let element = focusedElement {
            let axElement = element as! AXUIElement
            handleFocusedElement(axElement)
        }
    }
    
    /// Convert AX global coordinates to Cocoa screen coordinates (bottom-left)
    private func convertToCocoa(axPoint: CGPoint) -> CGPoint {
        let screens = NSScreen.screens
        let primaryScreen = screens.first { $0.frame.origin == .zero } ?? screens[0]
        let primaryHeight = primaryScreen.frame.height
        return CGPoint(x: axPoint.x, y: primaryHeight - axPoint.y)
    }

    /// Recursively find a descendant that supports text input
    private func findTextElement(in element: AXUIElement, depth: Int = 0) -> AXUIElement? {
        if depth > 25 { return nil } // Increased depth for deep browser DOMs
        
        let role = getRole(element)
        
        // 1. Try nested focus first (most specific and fastest)
        var nestedFocus: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXFocusedUIElementAttribute as CFString, &nestedFocus) == .success {
            let nested = nestedFocus as! AXUIElement
            // Avoid infinite recursion if the element returns itself
            if nested != element {
                if let found = findTextElement(in: nested, depth: depth + 1) {
                    return found
                }
            }
        }

        // 2. Check if this element itself is a text target
        var roleDescription: String = ""
        var roleDescRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXRoleDescriptionAttribute as CFString, &roleDescRef) == .success {
            roleDescription = (roleDescRef as? String) ?? ""
        }
        
        var names: CFArray?
        AXUIElementCopyAttributeNames(element, &names)
        let attributes = (names as? [String]) ?? []

        let isTextRole = role == kAXTextFieldRole || role == kAXTextAreaRole || role == "AXTextField" || role == "AXTextArea" || role == "textbox"
        let isComboBox = role == kAXComboBoxRole || role == "AXComboBox"
        let isStaticText = (role == "AXStaticText" || role == "AXHeading") && (attributes.contains(kAXValueAttribute) || attributes.contains(kAXSelectedTextRangeAttribute))
        let isEditor = roleDescription.lowercased().contains("editor") || roleDescription.lowercased().contains("document") || roleDescription.lowercased().contains("text") || roleDescription.lowercased().contains("field")

        // We accept roles that are clearly text-related OR if they have a selected text range attribute
        // But we EXCLUDE WebArea and some generic containers unless they are precisely what we need
        if (isTextRole || isComboBox || isStaticText || isEditor || attributes.contains(kAXSelectedTextRangeAttribute)) {
             // If it's a Group/WebArea, only accept if it actually has a value or role description indicating it's an editor
             if role == "AXGroup" || role == "AXWebArea" {
                 if !isEditor && !attributes.contains(kAXValueAttribute) && !attributes.contains(kAXSelectedTextRangeAttribute) {
                     return nil
                 }
             }
             
             if role != "AXWebArea" && role != "AXScrollArea" {
                 print("🎯 [AccessibilityMonitor] Identified text target: \(role) (\(roleDescription)) at depth \(depth)")
                 return element
             }
        }
        
        // 3. Drill into children as a last resort
        var children: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success, 
           let childrenArray = children as? [AXUIElement] {
            
            // Limit breadth to avoid O(N!) in massive trees
            // Web areas can have many siblings, but we usually want the one with focused children
            let maxChildren = (role == "AXWebArea") ? 2000 : 200
            let childrenToProcess = childrenArray.prefix(maxChildren)
            
            for child in childrenToProcess {
                if let found = findTextElement(in: child, depth: depth + 1) {
                    return found
                }
            }
        }
        
        return nil
    }

    /// Diagnostic: Dump the UI hierarchy for the targeted window/app
    func dumpHierarchy(start: AXUIElement, depth: Int = 0) {
        let indent = String(repeating: "  ", count: depth)
        let role = getRole(start)
        
        var title: CFTypeRef?
        AXUIElementCopyAttributeValue(start, kAXTitleAttribute as CFString, &title)
        let titleStr = title as? String ?? ""
        
        print("\(indent)📍 [\(role)] \(titleStr)")
        
        if depth > 8 { // Lower limit for dump
            return
        }
        
        var children: CFTypeRef?
        if AXUIElementCopyAttributeValue(start, kAXChildrenAttribute as CFString, &children) == .success,
           let childrenArray = children as? [AXUIElement] {
            for child in childrenArray {
                dumpHierarchy(start: child, depth: depth + 1)
            }
        }
    }

    private func getRole(_ element: AXUIElement) -> String {
        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        return (role as? String) ?? "Unknown"
    }

    func handleFocusedElement(_ element: AXUIElement) {
        let roleString = getRole(element)
        print("🔍 [AccessibilityMonitor] Evaluating focused element: \(roleString)")
        
        // Skip purely structural/ignore-list roles
        // Skip purely structural roles, but allow Toolbar/Group as they often contain text inputs
        let skipRoles = [kAXWindowRole, kAXSheetRole, kAXDrawerRole, kAXSystemWideRole, kAXScrollBarRole, kAXMenuRole, kAXMenuBarRole]
        if skipRoles.contains(roleString) {
            print("⏭️ [AccessibilityMonitor] Skipping structural role: \(roleString)")
            return 
        }

        var targetElement = element
        
        // Always try to drill down to the most specific text element
        if let foundChild = findTextElement(in: element) {
            if foundChild != element {
                print("🎯 Discovered deeper text element inside \(roleString) -> \(getRole(foundChild))")
                targetElement = foundChild
            }
        }
        
        if self.lastFocusedElement != targetElement {
            self.lastFocusedElement = targetElement
            self.lastKnownText = "" // Clear text cache when element changes
            print("🎯 Focus element changed to \(getRole(targetElement)). Clearing lastKnownText.")
        }

        // Check if the target supports text manipulation
        var names: CFArray?
        AXUIElementCopyAttributeNames(targetElement, &names)
        let attributes = (names as? [String]) ?? []
        
        let hasTextSupport = attributes.contains(kAXSelectedTextRangeAttribute) || attributes.contains(kAXValueAttribute)
        
        if hasTextSupport {
            let finalRole = getRole(targetElement)
            print("📝 [AccessibilityMonitor] Text-ready element focused: \(finalRole) (Attrs: \(attributes.count))")
            
            // Log names of attributes for better debugging
            if attributes.count < 15 {
                print("📝 [AccessibilityMonitor] Attrs: \(attributes.joined(separator: ", "))")
            }
            
            // Check for browser field bounds first (Overlay UI)
            let browserState = CursorTracker.shared.getBrowserState(element: targetElement)
            
            if let fieldRect = browserState.fieldBounds {
                print("🖼️ Showing overlay at \(fieldRect)")
                DispatchQueue.main.async {
                    OverlayWindowController.shared.show(at: fieldRect)
                }
            } else {
                // Log for debugging: what is the AX position of our target?
                var pVal: CFTypeRef?
                if AXUIElementCopyAttributeValue(targetElement, kAXPositionAttribute as CFString, &pVal) == .success {
                    var point = CGPoint.zero
                    AXValueGetValue(pVal as! AXValue, .cgPoint, &point)
                    print("📍 [AccessibilityMonitor] Target \(getRole(targetElement)) AX Position: \(point)")
                }
                
                DispatchQueue.main.async {
                    OverlayWindowController.shared.hide()
                }
            }
            
            // Use CursorTracker to get position (handles fallbacks for browser/Chrome)
            if let position = browserState.cursorPoint ?? CursorTracker.shared.getCursorPosition(from: targetElement) {
                // Initial creation might return (0,0) before layout is ready
                // But CursorTracker now handles most invalid cases
                onFocusChanged?(targetElement, position)
            } else {
                onFocusChanged?(targetElement, nil)
            }
        } else {
            print("⏭️ Skipping element: \(roleString) (Attrs: \(attributes.count))")
            DispatchQueue.main.async {
                OverlayWindowController.shared.hide()
            }
        }
    }
    
    public var lastKnownText = ""
    
    func handleTextChange(_ element: AXUIElement) {
        var value: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)
        
        if let text = value as? String {
            // Only process if we have actual text and it's different from last time
            guard !text.isEmpty else {
                print("📝 Text update skipped: empty")
                return
            }
            
            // Avoid duplicate processing
            guard text != lastKnownText else {
                return
            }
            
            lastKnownText = text
            print("✏️ [AccessibilityMonitor] Text changed in \(getRole(element)): \"\(text.suffix(50))...\" (len: \(text.count))")
            onTextChanged?(text, element)
        }
    }
    
    func handleSelectionChange(_ element: AXUIElement) {
        // Selection changes update cursor position
        if CursorTracker.shared.getCursorPosition(from: element) != nil {
            CursorTracker.shared.updateCursorPosition()
        }
        
        // Get the selected range
        var selectedRange: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &selectedRange) == .success {
            var range = CFRange()
            if AXValueGetValue(selectedRange as! AXValue, .cfRange, &range) {
                let nsRange = NSRange(location: range.location, length: range.length)
                
                // Get the text to show what's selected
                var text = ""
                var selectedText: CFTypeRef?
                if AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &selectedText) == .success {
                    text = (selectedText as? String) ?? ""
                }
                
                print("🎯 Selection changed: range=(\(nsRange.location), \(nsRange.length)) text=\"\(text)\"")
                onSelectionChanged?(text, nsRange, element)
            }
        }
    }
    
    // Callback for when selection changes: (text, range, element)
    var onSelectionChanged: ((String, NSRange, AXUIElement) -> Void)?
    

    
    // MARK: - Grammarly-Style Active Text Reading
    
    /// Proactively read text from the currently focused element (Grammarly approach)
    /// Unlike AXObserver notifications which many apps don't fire reliably,
    /// this actively polls the focused element after each keystroke
    func readFocusedElementText() -> (text: String, element: AXUIElement)? {
        // Try System-Wide first
        let systemWide = AXUIElementCreateSystemWide()
        var focusedElement: CFTypeRef?
        var focusError = AXUIElementCopyAttributeValue(
            systemWide,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElement
        )
        
        // 2. If system-wide fails, try the frontmost application directly
        if focusError != .success, let frontApp = NSWorkspace.shared.frontmostApplication {
            let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)
            
            // PROD: Ask directly without the heavy retry/sleep loop in the event path
            // If Chrome is asleep, we'll catch it in the background or on the next keypress
            focusError = AXUIElementCopyAttributeValue(
                appElement,
                kAXFocusedUIElementAttribute as CFString,
                &focusedElement
            )
            
            if focusError != .success || focusedElement == nil {
                // Try to get focused element from the Focused Window attribute (faster than window iteration)
                var focusedWindowRef: CFTypeRef?
                if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedWindowRef) == .success {
                    let windowElement = focusedWindowRef as! AXUIElement
                    focusError = AXUIElementCopyAttributeValue(
                        windowElement,
                        kAXFocusedUIElementAttribute as CFString,
                        &focusedElement
                    )
                }
            }
        }
        
        guard focusError == .success, let element = focusedElement else {
            return nil
        }
        
        var axElement = element as! AXUIElement
        
        // Identifying the element role
        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(axElement, kAXRoleAttribute as CFString, &role)
        let roleString = (role as? String) ?? "Unknown"
        
        // CHROMIUM FIX: Use the robust recursive finder to drill down
        if let foundElement = findTextElement(in: axElement) {
            axElement = foundElement
            AXUIElementCopyAttributeValue(axElement, kAXRoleAttribute as CFString, &role)
        }
        
        let finalRole = (role as? String) ?? roleString
        
        // SYNC: Ensure we update our tracker so DiagnosticService knows we have the REFINED focus
        let currentFocus = self.lastFocusedElement
        if currentFocus == nil || !CFEqual(currentFocus!, axElement) {
            self.lastFocusedElement = axElement
        }
        
        print("🎯 Focused Element Identified: \(finalRole)")
        
        // 2. Read the text value (try multiple attributes)
        let attributesToTry = [kAXValueAttribute, kAXSelectedTextAttribute, kAXDescriptionAttribute]
        var textValue: String?
        
        for attr in attributesToTry {
            var value: CFTypeRef?
            if AXUIElementCopyAttributeValue(axElement, attr as CFString, &value) == .success {
                if let text = value as? String, !text.isEmpty {
                    textValue = text
                    break
                }
            }
        }
        
        // Roles that typically contain text
        let textRoles = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, "AXStaticText", "AXWebArea", "AXTextField"]
        
        if let text = textValue {
            return (text: text, element: axElement)
        } else if textRoles.contains(where: { finalRole.contains($0) }) {
            // It's a text element but empty
            return (text: "", element: axElement)
        }
        
        return nil
    }
    
    /// Get the screen coordinates for a given text range in an element
    func getBoundsForRange(range: NSRange, element: AXUIElement) -> CGRect? {
        let cfRange = CFRange(location: range.location, length: range.length)
        guard let axRange = AXValueCreate(.cfRange, [cfRange]) else { return nil }
        
        var bounds: CFTypeRef?
        let error = AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXBoundsForRangeParameterizedAttribute as CFString,
            axRange,
            &bounds
        )
        
        if error == .success, let boundsValue = bounds {
            var rect = CGRect.zero
            if AXValueGetValue(boundsValue as! AXValue, .cgRect, &rect) {
                // Safety: specific check for degenerate WebKit/Chromium reporting (0,0)
                // Many web fields return (0,0) when they can't calculate bounds, leading to top-left ghosting.
                if rect.origin.x <= 1 && rect.origin.y <= 1 {
                    print("⚠️ [Accessibility] Bounds rejected: degenerate (0,0) for range \(range)")
                    return nil
                }
                
                // Safety: Check for suspiciously small rects (empty)
                if rect.width <= 0 || rect.height <= 0 {
                    return nil
                }

                let bottomLeft = convertToCocoa(axPoint: CGPoint(x: rect.origin.x, y: rect.origin.y + rect.height))
                return CGRect(origin: bottomLeft, size: rect.size)
            }
        }
        
        // Fallback: If bounds for range fails, try to at least get the element's overall bounds
        var position = CGPoint.zero
        var size = CGSize.zero
        var posValue: CFTypeRef?
        var sizeValue: CFTypeRef?
        
        if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posValue) == .success,
           AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success {
            if AXValueGetValue(posValue as! AXValue, .cgPoint, &position) &&
               AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) {
                let bottomLeft = convertToCocoa(axPoint: CGPoint(x: position.x, y: position.y + size.height))
                return CGRect(origin: bottomLeft, size: size)
            }
        }
        
        return nil
    }
    
    /// Get a semi-stable ID for a UI element (useful for tracking window focus)
    func getElementID(_ element: AXUIElement) -> Int64 {
        var pid: pid_t = 0
        AXUIElementGetPid(element, &pid)
        
        // Combine PID with the element's hash or address for a unique-ish ID
        let hash = Int64(bitPattern: UInt64(UInt(bitPattern: Unmanaged.passUnretained(element).toOpaque())))
        return (Int64(pid) << 32) | (hash & 0xFFFFFFFF)
    }

    /// Manually force accessibility features on the frontmost app
    func forceWakeAccessibility() {
        guard let app = NSWorkspace.shared.frontmostApplication else { return }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        
        let manualAttr = "AXManualAccessibility" as CFString
        let enhancedAttr = "AXEnhancedUserInterface" as CFString
        
        AXUIElementSetAttributeValue(appElement, manualAttr, kCFBooleanTrue)
        AXUIElementSetAttributeValue(appElement, enhancedAttr, kCFBooleanTrue)
        
        print("💥 Force-woke accessibility for: \(app.localizedName ?? "Unknown")")
        
        // Re-setup observer to be sure
        setupObserver(for: app)
    }
}

// C callback for AXObserver
private func observerCallback(
    observer: AXObserver,
    element: AXUIElement,
    notification: CFString,
    refcon: UnsafeMutableRawPointer?
) {
    guard let refcon = refcon else { return }
    
    let monitor = Unmanaged<AccessibilityMonitor>.fromOpaque(refcon).takeUnretainedValue()
    
    let notificationName = notification as String
    
    switch notificationName {
    case kAXFocusedUIElementChangedNotification:
        monitor.handleFocusedElement(element)
        
    case kAXValueChangedNotification:
        // Text value actually changed - process it
        monitor.handleTextChange(element)
        
    case kAXSelectedTextChangedNotification:
        // Selection/cursor moved
        monitor.handleSelectionChange(element)
        // CRITICAL: Some apps (Chrome, etc.) don't always fire ValueChanged when typing.
        // If the selection changed, the text likely did too. Check it.
        monitor.handleTextChange(element)
        
    default:
        print("📢 Notification: \(notificationName)")
    }
}
import SwiftUI
import Combine

struct FloatingBubbleView: View {
    @ObservedObject var state: BubbleState
    
    var body: some View {
        VStack(spacing: 0) {
            if !state.predictions.isEmpty {
                // Prediction pills row + optional rewrite button
                predictionRow
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.9)).combined(with: .move(edge: .top)),
                        removal: .opacity.combined(with: .scale(scale: 0.9))
                    ))
                
                // Small triangle pointing down toward the cursor
                TrianglePointer()
                    .fill(Color(white: 0.15))
                    .frame(width: 10, height: 5)
                    .padding(.top, -1)
                    .transition(.opacity)
            } else if state.isTyping {
                if !state.analyzedText.isEmpty {
                    Text(state.analyzedText)
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundColor(.gray)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.black.opacity(0.1))
                        .cornerRadius(3)
                        .padding(.bottom, 4)
                }
                
                // Thinking indicator
                ThinkingIndicator()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 15)
                            .fill(Color(white: 0.15))
                            .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
                    )
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: state.predictions.isEmpty)
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: state.isTyping)
        .fixedSize()
        // Add padding to ensure scaled elements don't hit window edges
        .padding(6)
        .background(Color.clear)
    }
    
    private var predictionRow: some View {
        HStack(spacing: 6) {
            ForEach(state.predictions.prefix(5)) { prediction in
                let index = state.predictions.firstIndex(of: prediction) ?? 0
                let isSelected = state.selectedIndex == index
                
                Button(action: {
                    state.onPredictionSelected?(prediction)
                }) {
                    HStack(spacing: 4) {
                        if prediction.type == .correction {
                            Text("✨")
                                .font(.system(size: isSelected ? 10 : 8))
                        } else if prediction.type == .synonym {
                            Text("📖")
                                .font(.system(size: isSelected ? 10 : 8))
                        }
                        
                        Text(prediction.word)
                            .font(.system(size: prediction.type == .correction ? 12 : 11,
                                        weight: isSelected ? .bold : (prediction.type == .correction ? .bold : .medium),
                                        design: .rounded))
                            .fixedSize() // Prevent text wrapping
                    }
                    .foregroundColor(
                        isSelected
                            ? .white
                            : (prediction.type == .correction ? .mint : Color(white: 0.92))
                    )
                    // The "Push" effect: Layout padding changes
                    .padding(.horizontal, isSelected ? 12 : 8)
                    .padding(.vertical, isSelected ? 6 : 4)
                    .background(
                        ZStack {
                            if isSelected {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(LinearGradient(colors: [Color(nsColor: .systemBlue), Color(nsColor: .systemPurple)], startPoint: .topLeading, endPoint: .bottomTrailing))
                                    .shadow(color: Color(nsColor: .systemBlue).opacity(0.4), radius: 5, x: 0, y: 2)
                            } else {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(prediction.type == .correction ? Color.mint.opacity(0.15) : Color(white: 0.28))
                            }
                        }
                    )
                }
                .buttonStyle(.plain)
                // The "Balloon" effect: Visual scaling + Z-index pop
                .scaleEffect(isSelected ? 1.12 : 1.0)
                .zIndex(isSelected ? 1 : 0)
                .animation(.spring(response: 0.3, dampingFraction: 0.65), value: state.selectedIndex)
            }
            
            // AI Rewrite button (small circle)
            Button(action: {
                state.onRewriteTapped?()
            }) {
                Image(systemName: "sparkles")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(.white)
                    .padding(4)
                    .background(
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [.green, .mint],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .shadow(color: Color.green.opacity(0.3), radius: 2, y: 1)
                    )
            }
            .buttonStyle(.plain)
            .help("Rewrite with AI")
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(white: 0.15))
                .shadow(color: .black.opacity(0.3), radius: 6, y: 3)
        )
    }
}

struct ThinkingIndicator: View {
    @State private var pulse = false
    
    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
            
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true).delay(0.2), value: pulse)
            
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true).delay(0.4), value: pulse)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}

/// Small downward-pointing triangle shape
struct TrianglePointer: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

class BubbleState: ObservableObject {
    @Published var isActive = true
    @Published var isTyping = false
    @Published var analyzedText = ""          // Text currently being analyzed (live feedback)
    @Published var predictions: [Prediction] = []
    @Published var hasGrammarError = false
    @Published var selectedIndex: Int? = nil  // nil = no selection active
    @Published var isSelectionMode = false    // true when keyboard navigation is active
    
    @Published var isPinned = false           // true when user dragged the bubble manually
    
    // Callback for AI rewrite button
    var onRewriteTapped: (() -> Void)?
    // Callback for manual prediction selection (clicking)
    var onPredictionSelected: ((Prediction) -> Void)?
    
    func unpin() {
        withAnimation {
            isPinned = false
        }
        // Trigger a position update immediately
        CursorTracker.shared.updateCursorPosition()
    }
    
    func selectNext() {
        guard !predictions.isEmpty else { return }
        if let current = selectedIndex {
            selectedIndex = min(current + 1, predictions.count - 1)
        } else {
            selectedIndex = 0
        }
        isSelectionMode = true
    }
    
    func selectPrevious() {
        guard !predictions.isEmpty else { return }
        if let current = selectedIndex {
            selectedIndex = max(current - 1, 0)
        } else {
            selectedIndex = predictions.count - 1
        }
        isSelectionMode = true
    }
    
    func activateSelection() {
        guard !predictions.isEmpty else { return }
        selectedIndex = 0
        isSelectionMode = true
    }
    
    func cancelSelection() {
        selectedIndex = nil
        isSelectionMode = false
    }
    
    func getSelectedPrediction() -> Prediction? {
        guard let index = selectedIndex, index < predictions.count else { return nil }
        return predictions[index]
    }
}
# Latest Refactor Backup with Animations
import SwiftUI
import Combine

struct FloatingBubbleView: View {
    @ObservedObject var state: BubbleState
    
    var body: some View {
        VStack(spacing: 0) {
            if !state.predictions.isEmpty {
                // Prediction pills row + optional rewrite button
                predictionRow
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.9)).combined(with: .move(edge: .top)),
                        removal: .opacity.combined(with: .scale(scale: 0.9))
                    ))
                
                // Small triangle pointing down toward the cursor
                TrianglePointer()
                    .fill(Color(white: 0.15))
                    .frame(width: 10, height: 5)
                    .padding(.top, -1)
                    .transition(.opacity)
            } else if state.isTyping {
                if !state.analyzedText.isEmpty {
                    Text(state.analyzedText)
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundColor(.gray)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.black.opacity(0.1))
                        .cornerRadius(3)
                        .padding(.bottom, 4)
                }
                
                // Thinking indicator
                ThinkingIndicator()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 15)
                            .fill(Color(white: 0.15))
                            .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
                    )
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: state.predictions.isEmpty)
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: state.isTyping)
        .fixedSize()
        // Add padding to ensure scaled elements don't hit window edges
        .padding(6)
        .background(Color.clear)
    }
    
    @Namespace private var animation
    
    private var predictionRow: some View {
        HStack(spacing: 6) {
            ForEach(Array(state.predictions.prefix(5).enumerated()), id: \.element.id) { index, prediction in
                let isSelected = state.selectedIndex == index
                
                Button(action: {
                    state.onPredictionSelected?(prediction)
                }) {
                    HStack(spacing: 4) {
                        if prediction.type == .correction {
                            Text("✨")
                                .font(.system(size: isSelected ? 10 : 8))
                        } else if prediction.type == .synonym {
                            Text("📖")
                                .font(.system(size: isSelected ? 10 : 8))
                        }
                        
                        Text(prediction.word)
                            .font(.system(size: prediction.type == .correction ? 12 : 11,
                                        weight: isSelected ? .bold : (prediction.type == .correction ? .bold : .medium),
                                        design: .rounded))
                            .fixedSize()
                    }
                    .foregroundColor(
                        isSelected
                            ? .white
                            : (prediction.type == .correction ? .mint : Color(white: 0.92))
                    )
                    .padding(.horizontal, isSelected ? 12 : 8)
                    .padding(.vertical, isSelected ? 6 : 4)
                    .background(
                        ZStack {
                            if isSelected {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(LinearGradient(colors: [Color(nsColor: .systemBlue), Color(nsColor: .systemPurple)], startPoint: .topLeading, endPoint: .bottomTrailing))
                                    .shadow(color: Color(nsColor: .systemBlue).opacity(0.4), radius: 5, x: 0, y: 2)
                                    .matchedGeometryEffect(id: "highlight", in: animation)
                            } else {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(prediction.type == .correction ? Color.mint.opacity(0.15) : Color(white: 0.28))
                            }
                        }
                    )
                }
                .buttonStyle(.plain)
                .scaleEffect(isSelected ? 1.05 : 1.0)
                .zIndex(isSelected ? 1 : 0)
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: state.selectedIndex)
                // Staggered entry animation
                .transition(.asymmetric(
                    insertion: .scale(scale: 0.5).combined(with: .opacity).animation(.spring().delay(Double(index) * 0.05)),
                    removal: .scale(scale: 0.5).combined(with: .opacity)
                ))
            }
            
            // AI Rewrite button
            Button(action: {
                state.onRewriteTapped?()
            }) {
                Image(systemName: "sparkles")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(.white)
                    .padding(4)
                    .background(
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [.green, .mint],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .shadow(color: Color.green.opacity(0.3), radius: 2, y: 1)
                    )
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .scaleEffect(state.isSelectionMode ? 0.9 : 1.0) // Subtle shy effect when typing
            .animation(.default, value: state.isSelectionMode)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(white: 0.15))
                .shadow(color: .black.opacity(0.3), radius: 6, y: 3)
        )
    }
}

struct ThinkingIndicator: View {
    @State private var pulse = false
    
    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
            
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true).delay(0.2), value: pulse)
            
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true).delay(0.4), value: pulse)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}

/// Small downward-pointing triangle shape
struct TrianglePointer: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

class BubbleState: ObservableObject {
    @Published var isActive = true
    @Published var isTyping = false
    @Published var analyzedText = ""          // Text currently being analyzed (live feedback)
    @Published var predictions: [Prediction] = []
    @Published var hasGrammarError = false
    @Published var selectedIndex: Int? = nil  // nil = no selection active
    @Published var isSelectionMode = false    // true when keyboard navigation is active
    
    @Published var isPinned = false           // true when user dragged the bubble manually
    
    // Callback for AI rewrite button
    var onRewriteTapped: (() -> Void)?
    // Callback for manual prediction selection (clicking)
    var onPredictionSelected: ((Prediction) -> Void)?
    
    func unpin() {
        withAnimation {
            isPinned = false
        }
        // Trigger a position update immediately
        CursorTracker.shared.updateCursorPosition()
    }
    
    func selectNext() {
        guard !predictions.isEmpty else { return }
        if let current = selectedIndex {
            selectedIndex = min(current + 1, predictions.count - 1)
        } else {
            selectedIndex = 0
        }
        isSelectionMode = true
    }
    
    func selectPrevious() {
        guard !predictions.isEmpty else { return }
        if let current = selectedIndex {
            selectedIndex = max(current - 1, 0)
        } else {
            selectedIndex = predictions.count - 1
        }
        isSelectionMode = true
    }
    
    func activateSelection() {
        guard !predictions.isEmpty else { return }
        selectedIndex = 0
        isSelectionMode = true
    }
    
    func cancelSelection() {
        selectedIndex = nil
        isSelectionMode = false
    }
    
    func getSelectedPrediction() -> Prediction? {
        guard let index = selectedIndex, index < predictions.count else { return nil }
        return predictions[index]
    }
}
# Backup before Fix Rotation and Expand Dictionary
import SwiftUI
import Combine

struct FloatingBubbleView: View {
    @ObservedObject var state: BubbleState
    
    var body: some View {
        VStack(spacing: 0) {
            if !state.predictions.isEmpty {
                // Prediction pills row + optional rewrite button
                predictionRow
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .scale(scale: 0.9)).combined(with: .move(edge: .top)),
                        removal: .opacity.combined(with: .scale(scale: 0.9))
                    ))
                
                // Small triangle pointing down toward the cursor
                TrianglePointer()
                    .fill(Color(white: 0.15))
                    .frame(width: 10, height: 5)
                    .padding(.top, -1)
                    .transition(.opacity)
            } else if state.isTyping {
                if !state.analyzedText.isEmpty {
                    Text(state.analyzedText)
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundColor(.gray)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.black.opacity(0.1))
                        .cornerRadius(3)
                        .padding(.bottom, 4)
                }
                
                // Thinking indicator
                ThinkingIndicator()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 15)
                            .fill(Color(white: 0.15))
                            .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
                    )
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: state.predictions.isEmpty)
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: state.isTyping)
        .fixedSize()
        // Add padding to ensure scaled elements don't hit window edges
        .padding(6)
        .background(Color.clear)
    }
    
    @Namespace private var animation
    
    private var predictionRow: some View {
        HStack(spacing: 6) {
            ForEach(Array(state.predictions.prefix(5).enumerated()), id: \.element.id) { index, prediction in
                let isSelected = state.selectedIndex == index
                
                Button(action: {
                    state.onPredictionSelected?(prediction)
                }) {
                    HStack(spacing: 4) {
                        if prediction.type == .correction {
                            Text("✨")
                                .font(.system(size: isSelected ? 10 : 8))
                        } else if prediction.type == .synonym {
                            Text("📖")
                                .font(.system(size: isSelected ? 10 : 8))
                        }
                        
                        Text(prediction.word)
                            .font(.system(size: prediction.type == .correction ? 13 : 11, // Slightly larger base
                                        weight: isSelected ? .heavy : (prediction.type == .correction ? .bold : .medium),
                                        design: .rounded))
                            .fixedSize()
                    }
                    .foregroundColor(
                        isSelected
                            ? .white
                            : (prediction.type == .correction ? .mint : Color(white: 0.92))
                    )
                    .padding(.horizontal, isSelected ? 14 : 8) // More padding for selected
                    .padding(.vertical, isSelected ? 7 : 4)
                    .background(
                        ZStack {
                            if isSelected {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(LinearGradient(colors: [Color(nsColor: .systemBlue), Color(nsColor: .systemPurple)], startPoint: .topLeading, endPoint: .bottomTrailing))
                                    .shadow(color: Color(nsColor: .systemBlue).opacity(0.5), radius: 6, x: 0, y: 3)
                                    .matchedGeometryEffect(id: "highlight", in: animation)
                            } else {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(prediction.type == .correction ? Color.mint.opacity(0.15) : Color(white: 0.28))
                            }
                        }
                    )
                }
                .buttonStyle(.plain)
                .scaleEffect(isSelected ? 1.15 : 1.0) // More "pop"
                .zIndex(isSelected ? 10 : 0) // Ensure selected is always on top
                .animation(.interpolatingSpring(stiffness: 300, damping: 20), value: state.selectedIndex)
                // Simplified transition to prevent flashing/ripples during rapid updates
                .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
            
            // AI Rewrite button
            Button(action: {
                state.onRewriteTapped?()
            }) {
                Image(systemName: "sparkles")
                    .font(.system(size: 9, weight: .bold)) // Slightly larger icon
                    .foregroundColor(.white)
                    .padding(5)
                    .background(
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [.green, .mint],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .shadow(color: Color.green.opacity(0.4), radius: 3, y: 1)
                    )
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.4), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .scaleEffect(state.isSelectionMode ? 0.9 : 1.0) // Subtle shy effect when typing
            .animation(.default, value: state.isSelectionMode)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(white: 0.15))
                .shadow(color: .black.opacity(0.3), radius: 6, y: 3)
        )
    }
}

struct ThinkingIndicator: View {
    @State private var pulse = false
    
    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
            
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true).delay(0.2), value: pulse)
            
            Circle()
                .fill(Color.mint)
                .frame(width: 4, height: 4)
                .scaleEffect(pulse ? 1.5 : 1.0)
                .opacity(pulse ? 1.0 : 0.5)
                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true).delay(0.4), value: pulse)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}

/// Small downward-pointing triangle shape
struct TrianglePointer: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

class BubbleState: ObservableObject {
    @Published var isActive = true
    @Published var isTyping = false
    @Published var analyzedText = ""          // Text currently being analyzed (live feedback)
    @Published var predictions: [Prediction] = []
    @Published var hasGrammarError = false
    @Published var selectedIndex: Int? = nil  // nil = no selection active
    @Published var isSelectionMode = false    // true when keyboard navigation is active
    
    @Published var isPinned = false           // true when user dragged the bubble manually
    
    // Callback for AI rewrite button
    var onRewriteTapped: (() -> Void)?
    // Callback for manual prediction selection (clicking)
    var onPredictionSelected: ((Prediction) -> Void)?
    
    func unpin() {
        withAnimation {
            isPinned = false
        }
        // Trigger a position update immediately
        CursorTracker.shared.updateCursorPosition()
    }
    
    func selectNext() {
        guard !predictions.isEmpty else { return }
        if let current = selectedIndex {
            selectedIndex = min(current + 1, predictions.count - 1)
        } else {
            selectedIndex = 0
        }
        isSelectionMode = true
    }
    
    func selectPrevious() {
        guard !predictions.isEmpty else { return }
        if let current = selectedIndex {
            selectedIndex = max(current - 1, 0)
        } else {
            selectedIndex = predictions.count - 1
        }
        isSelectionMode = true
    }
    
    func activateSelection() {
        guard !predictions.isEmpty else { return }
        selectedIndex = 0
        isSelectionMode = true
    }
    
    func cancelSelection() {
        selectedIndex = nil
        isSelectionMode = false
    }
    
    func getSelectedPrediction() -> Prediction? {
        guard let index = selectedIndex, index < predictions.count else { return nil }
        return predictions[index]
    }
}

---

# 🔄 REFACTOR BACKUP — 2026-02-15T02:30 IST

## Changes Being Made:
1. Fix selected word rotation/skew animation artifact
2. Dictionary already at 50k (verified)
3. Add contractions (isn't, don't, etc.) to words_50k.txt
4. Smoother animations with better spring params
5. Better alternative words & grammar suggestions
6. This refactor backup (done first)

## Files Modified:
- FloatingBubbleView.swift (animation fix)
- SynonymService.swift (expanded synonyms to 200+)
- FloatingBubbleWindowController.swift (better selection analysis)
- words_50k.txt (added ~60 contractions)

## FloatingBubbleView.swift (PRE-CHANGE — 252 lines)
## SynonymService.swift (PRE-CHANGE — 59 lines)
## FloatingBubbleWindowController.swift (PRE-CHANGE — 429 lines)
## words_50k.txt — Word Count: 50,022 words

### Key code sections backed up:

#### FloatingBubbleView — predictionRow (the animation code being fixed):
```
.matchedGeometryEffect(id: "highlight", in: animation)
.drawingGroup() // Force Metal rendering to fix skewed anti-aliasing
```
These two lines are the root cause of the rotation/skew artifact and will be removed.

#### SynonymService — Full dictionary (30 entries) will be expanded to 200+

#### FloatingBubbleWindowController — handleSelectionAnalysis will be enhanced with:
- NSSpellChecker completions for better alternatives
- Grammar-level suggestions
- Up to 5 suggestions per selection

**To revert**: Restore the files from git or copy the code from the previous backup sections above.
**Git commit recommended before proceeding.**

**END OF BACKUP — 2026-02-15T02:30 IST**

# FINAL STABLE STATE - FEB 15 2026
## Resolved: Accessibility Permission Desync & Sandbox Restriction

### The "Core Bug" fix:
The application was sandboxed, which caused kAXErrorAPIDisabled (-25204). 
Disabling the App Sandbox in project.pbxproj restored all system-wide features.

### Key Working Modules:
- **AccessibilityMonitor**: Now supports raw AX error tracking and aggressive polling.
- **CursorTracker**: Multi-method fallback (AXBounds -> Anchor -> Mouse).
- **DiagnosticService**: Built-in visual health check and AX error reporting.

### Permanent Context Rules (Added to .agent/rules):
1. No unnecessary refactors of core modules.
2. Mandatory backup before editing working code.
3. Sandbox must remain OFF.

# 🔄 REFACTOR BACKUP — Tue Feb 17 01:41:08 IST 2026

## Changes Made:
1.  **Fixed Screen Resolution Handling:** `DebugOverlayWindowController.swift` no longer hardcodes 1920x1080. It dynamically uses `NSScreen.main?.frame` on startup and on `show()`.
2.  **Fixed Cursor Lag/Slowness:** `AccessibilityMonitor.swift` now throttles `handleTextChange` and `handleSelectionChange` events to max 1 per 50ms. This prevents system overload during rapid cursor movement (e.g., holding arrow keys).
3.  **Fixed Floating Bubble Positioning:** `FloatingBubbleWindowController.swift` now positions the bubble **below** the caret (previously above) to align with the G-button behavior and avoid obscuring typing.
4.  **Verified Browser Integration:** Confirmed `content.js` logic for coordinate reporting and `CursorTracker.swift` handling.

## Files Modified:
- `GrammarFlow/UI/Windows/DebugOverlayWindowController.swift`
- `GrammarFlow/Core/AccessibilityMonitor.swift`
- `GrammarFlow/UI/Windows/FloatingBubbleWindowController.swift`

## Key Code Changes (Summary):

### AccessibilityMonitor.swift (Throttling)
```swift
private var lastEventTime: Date = Date.distantPast
private let eventThrottle: TimeInterval = 0.05

func handleTextChange(_ element: AXUIElement) {
    let now = Date()
    if now.timeIntervalSince(lastEventTime) < eventThrottle { return }
    lastEventTime = now
    // ...
}
```

### DebugOverlayWindowController.swift (Resolution)
```swift
let screenRect = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1920, height: 1080)
// ...
func show() {
    updateFrame()
    overlayWindow?.orderFrontRegardless()
}
```

**END OF BACKUP — Tue Feb 17 01:41:08 IST 2026**
