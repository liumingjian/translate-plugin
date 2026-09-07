import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2, let rawPid = Int32(CommandLine.arguments[1]) else {
  exit(2)
}

let source = CGEventSource(stateID: .hidSystemState)
let flags: CGEventFlags = [.maskAlternate, .maskShift]
guard
  let down = CGEvent(keyboardEventSource: source, virtualKey: 1, keyDown: true),
  let up = CGEvent(keyboardEventSource: source, virtualKey: 1, keyDown: false)
else {
  exit(3)
}
down.flags = flags
up.flags = flags
down.postToPid(pid_t(rawPid))
usleep(80_000)
up.postToPid(pid_t(rawPid))
