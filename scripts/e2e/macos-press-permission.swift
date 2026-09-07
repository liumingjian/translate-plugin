import ApplicationServices
import Foundation

guard CommandLine.arguments.count >= 2, let rawPid = Int32(CommandLine.arguments[1]) else {
  fputs("invalid-pid\n", stderr)
  exit(2)
}

let app = AXUIElementCreateApplication(pid_t(rawPid))
var visited = Set<CFHashCode>()
var sheet: AXUIElement?
var firstError: AXError?

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
  var value: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, name, &value)
  if error != .success, error != .noValue, error != .attributeUnsupported, firstError == nil {
    firstError = error
  }
  return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String? {
  attribute(element, name) as? String
}

func findSheetAndDefaultButton(_ element: AXUIElement, depth: Int) -> AXUIElement? {
  if depth > 16 { return nil }
  let identity = CFHash(element)
  if visited.contains(identity) { return nil }
  visited.insert(identity)

  let role = stringAttribute(element, kAXRoleAttribute as CFString)
  if role == (kAXSheetRole as String) { sheet = element }
  if let value = attribute(element, kAXDefaultButtonAttribute as CFString) {
    let button = unsafeBitCast(value, to: AXUIElement.self)
    if stringAttribute(button, kAXRoleAttribute as CFString) == (kAXButtonRole as String) {
      return button
    }
  }
  guard let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else {
    return nil
  }
  for child in children {
    if let button = findSheetAndDefaultButton(child, depth: depth + 1) { return button }
  }
  return nil
}

func pressableButtons(_ element: AXUIElement) -> [AXUIElement] {
  var buttons: [AXUIElement] = []
  if stringAttribute(element, kAXRoleAttribute as CFString) == (kAXButtonRole as String) {
    var actionNames: CFArray?
    let error = AXUIElementCopyActionNames(element, &actionNames)
    let actions = error == .success ? actionNames as? [String] ?? [] : []
    let enabled = attribute(element, kAXEnabledAttribute as CFString) as? Bool ?? false
    if enabled && actions.contains(kAXPressAction as String) { buttons.append(element) }
  }
  if let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
    for child in children { buttons.append(contentsOf: pressableButtons(child)) }
  }
  return buttons
}

func finish(_ payload: [String: Any], code: Int32) -> Never {
  let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
  print(String(decoding: data, as: UTF8.self))
  exit(code)
}

guard AXIsProcessTrusted() else {
  finish(["ok": false, "reason": "ax-process-not-trusted"], code: 10)
}

let defaultButton = findSheetAndDefaultButton(app, depth: 0)
let sheetButtons = sheet.map(pressableButtons) ?? []
let expectedLabel = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
let labelledButtons = expectedLabel.map { expected in
  sheetButtons.filter { button in
    stringAttribute(button, kAXTitleAttribute as CFString) == expected ||
      stringAttribute(button, kAXDescriptionAttribute as CFString) == expected
  }
} ?? []
guard let button = defaultButton ?? (labelledButtons.count == 1 ? labelledButtons[0] : nil) else {
  finish([
    "ok": false,
    "reason": "ax-accept-button-not-unique",
    "axError": firstError.map { Int($0.rawValue) } as Any,
    "sheetButtons": sheetButtons.count,
    "labelMatches": labelledButtons.count,
  ], code: 11)
}

let pressError = AXUIElementPerformAction(button, kAXPressAction as CFString)
finish([
  "ok": pressError == .success,
  "reason": pressError == .success ? "pressed-accept-button" : "ax-press-failed",
  "axError": Int(pressError.rawValue),
  "selection": defaultButton == nil ? "label" : "default-button",
], code: pressError == .success ? 0 : 12)
