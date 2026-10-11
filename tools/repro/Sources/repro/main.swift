import CodexBarCore
import Foundation

/// Runs a CodexBar user plugin through the real plugin runtime instead of a hand-written stub.
///
/// `check.mjs` fakes the host, and a fake host can hide host-side contracts: it once turned the
/// bundled-only `acceptCookie` into a no-op, so the plugin stayed green locally while every
/// successful fetch failed inside the app. This harness loads the plugin through
/// `UserProviderPluginLoader` and fetches through `ProviderPluginRuntime` with the same call shape
/// `UsageStore+UserPlugins.swift` uses, on whichever engine the app would pick.
///
/// It is a debugging tool: `node check.mjs` remains the required check.

// MARK: - Options

private enum CookieMode: String {
    case session
    case missing
    case empty

    var summary: String {
        switch self {
        case .session: "resolver returns a session cookie header"
        case .missing: "resolver throws like UserProviderPluginCookieBroker with no Chrome cookies"
        case .empty: "resolver returns an empty header"
        }
    }
}

private struct Options {
    var pluginPath = "shanhe.js"
    var mode: CookieMode = .session
    var bodyPath: String?
    var recordsPath: String?
    var recordsDelaySeconds = 0.0
    var status = 200
    var attempts = 3
    var expectOK = false
}

private let usageText = """
Usage: repro [plugin.js] [mode] [body.html] [flags]

  plugin.js   plugin source to load (default: shanhe.js)
  mode        cookie resolver behaviour: session (default) | missing | empty
  body.html   response body to serve (default: fixtures/dashboard.html, else a login page)

Flags:
  --records <path>   body served for the optional user_api.php request (default: fixtures/records.json)
  --records-delay <s>  seconds the optional request takes (default: 0; the real page takes ~0.6)
  --status <code>    HTTP status the stub transport returns (default: 200)
  --attempts <n>     sequential fetches on one runtime, like the app's refreshes (default: 3)
  --expect-ok        exit 1 when any fetch fails
  -h, --help         show this message

Environment:
  CODEXBAR_PLUGIN_ENGINE=quickjs|jsc   force an engine (default: the runtime's choice, QuickJS)
  CODEXBAR_SOURCE=<CodexBar checkout>  see tools/repro/README.md
"""

private func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("repro: \(message)\n\n\(usageText)\n".utf8))
    exit(2)
}

private func parse(_ arguments: [String]) -> Options {
    var options = Options()
    var positional: [String] = []
    var index = 0
    while index < arguments.count {
        let argument = arguments[index]
        switch argument {
        case "--expect-ok":
            options.expectOK = true
        case "--records":
            index += 1
            guard index < arguments.count else { fail("--records needs a path") }
            options.recordsPath = arguments[index]
        case "--records-delay":
            index += 1
            guard index < arguments.count, let delay = Double(arguments[index]), delay >= 0 else {
                fail("--records-delay needs a non-negative number of seconds")
            }
            options.recordsDelaySeconds = delay
        case "--status":
            index += 1
            guard index < arguments.count, let status = Int(arguments[index]), (100..<600).contains(status) else {
                fail("--status needs an HTTP status code")
            }
            options.status = status
        case "--attempts":
            index += 1
            guard index < arguments.count, let attempts = Int(arguments[index]), attempts > 0 else {
                fail("--attempts needs a positive integer")
            }
            options.attempts = attempts
        case "-h", "--help":
            print(usageText)
            exit(0)
        default:
            guard !argument.hasPrefix("-") else { fail("unknown option '\(argument)'") }
            positional.append(argument)
        }
        index += 1
    }
    guard positional.count <= 3 else { fail("too many arguments") }
    if positional.count > 0 { options.pluginPath = positional[0] }
    if positional.count > 1 {
        guard let mode = CookieMode(rawValue: positional[1]) else { fail("unknown mode '\(positional[1])'") }
        options.mode = mode
    }
    if positional.count > 2 { options.bodyPath = positional[2] }
    return options
}

// MARK: - Stubs

/// Serves the canned dashboard for every request, and the canned request log for the optional
/// `user_api.php` enrichment, while tracing what the plugin asked for.
///
/// `recordsDelaySeconds` reproduces the vendor's real latency (the 560 KB page takes ~0.6 s). That
/// matters because the host only collects an optional response while the `optionalBudgetSeconds`
/// budget lasts, so a plugin that forgets to raise the budget loses the chart on a real refresh but
/// passes instantly against an instant stub.
private struct StubTransport: ProviderHTTPTransport {
    let body: String
    let records: String?
    let status: Int
    let recordsDelaySeconds: Double

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = request.url ?? URL(string: "https://invalid.example")!
        let cookie = request.value(forHTTPHeaderField: "Cookie") ?? "-"
        trace("HTTP \(request.httpMethod ?? "GET") \(url.absoluteString) cookie=\(cookie)")
        let isRecords = url.absoluteString.contains("user_api.php")
        if isRecords, self.recordsDelaySeconds > 0 {
            try await Task.sleep(for: .seconds(self.recordsDelaySeconds))
        }
        let payload = (isRecords ? self.records : nil) ?? self.body
        let response = HTTPURLResponse(
            url: url,
            statusCode: self.status,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": isRecords && self.records != nil
                    ? "application/json; charset=utf-8"
                    : "text/html; charset=utf-8",
            ])!
        return (Data(payload.utf8), response)
    }
}

private let loginPage = "<html><body><form>请登录 Login</form></body></html>"

private func trace(_ message: String) {
    FileHandle.standardError.write(Data("  [host] \(message)\n".utf8))
}

// MARK: - Entry point

@main
private struct PluginRepro {
    static func main() async {
        let options = parse(Array(CommandLine.arguments.dropFirst()))
        do {
            try await self.run(options)
        } catch {
            FileHandle.standardError.write(Data("repro failed: \(error.localizedDescription)\n".utf8))
            exit(2)
        }
    }

    private static func run(_ options: Options) async throws {
        let body = try self.responseBody(for: options)
        let records = try self.recordsBody(for: options)
        let engine = ProcessInfo.processInfo.environment["CODEXBAR_PLUGIN_ENGINE"]?.lowercased() ?? "default (QuickJS)"
        print("engine: \(engine)")
        print("mode:   \(options.mode.rawValue) — \(options.mode.summary)")
        print("status: \(options.status)")
        print("records: \(options.recordsPath ?? (records == nil ? "none (chart dropped)" : "fixtures/records.json"))")
        if options.recordsDelaySeconds > 0 { print("records delay: \(options.recordsDelaySeconds)s") }

        let stateDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("codexbar-plugin-repro", isDirectory: true)
        let loader = UserProviderPluginLoader(
            providersDirectory: stateDirectory.appendingPathComponent("providers", isDirectory: true),
            cacheDirectory: stateDirectory.appendingPathComponent("cache", isDirectory: true),
            transport: StubTransport(
                body: body,
                records: records,
                status: options.status,
                recordsDelaySeconds: options.recordsDelaySeconds))
        let plugin = try loader.load(fileURL: URL(fileURLWithPath: options.pluginPath))
        print("loaded: \(plugin.manifest.id.rawValue) — \(plugin.manifest.name)")
        print("  capabilities:  \(plugin.manifest.capabilities.map(\.rawValue).joined(separator: ", "))")
        print("  cookieDomains: \(plugin.manifest.cookieDomains.joined(separator: ", "))")
        print("  cookiePolicy:  \(plugin.manifest.cookiePolicy.map(String.init(describing:)) ?? "none (user plugin)")")

        // A throwaway approval store: never touch the real one under Application Support.
        let approvalStore = ProviderPluginApprovalStore(
            fileURL: stateDirectory.appendingPathComponent("plugin-approvals.json"))
        try approvalStore.record(try plugin.approvalBinding(settings: [:]))

        let instanceResolver: ProviderPluginRuntime.InstanceCookieResolver = { _, domain in
            trace("cookieSession \(domain)")
            switch options.mode {
            case .session: return "session=fixture"
            case .missing: throw ProviderPluginError.secretAccess("no browser session cookies were found")
            case .empty: return ""
            }
        }

        var failures = 0
        for attempt in 1...options.attempts {
            do {
                let snapshot = try await plugin.fetchUsage(
                    settings: [:],
                    secrets: [:],
                    environment: [:],
                    approvalStore: approvalStore,
                    instanceCookieResolver: instanceResolver)
                print("fetch #\(attempt): OK")
                self.printSnapshot(snapshot)
            } catch {
                failures += 1
                print("fetch #\(attempt): FAILED — \(error.localizedDescription)")
                print("  error type: \(type(of: error))")
            }
        }

        if options.expectOK, failures > 0 {
            print("expected every fetch to succeed; \(failures) of \(options.attempts) failed")
            exit(1)
        }
    }

    private static func responseBody(for options: Options) throws -> String {
        if let bodyPath = options.bodyPath {
            return try String(contentsOfFile: bodyPath, encoding: .utf8)
        }
        let fixture = "fixtures/dashboard.html"
        if FileManager.default.fileExists(atPath: fixture) {
            return try String(contentsOfFile: fixture, encoding: .utf8)
        }
        trace("no \(fixture) in \(FileManager.default.currentDirectoryPath); serving a login page")
        return loginPage
    }

    private static func recordsBody(for options: Options) throws -> String? {
        if let recordsPath = options.recordsPath {
            return try String(contentsOfFile: recordsPath, encoding: .utf8)
        }
        let fixture = "fixtures/records.json"
        guard FileManager.default.fileExists(atPath: fixture) else {
            trace("no \(fixture) in \(FileManager.default.currentDirectoryPath); the optional request returns nothing")
            return nil
        }
        return try? String(contentsOfFile: fixture, encoding: .utf8)
    }

    private static func printSnapshot(_ snapshot: UsageSnapshot) {
        print("  primary.usedPercent: \(snapshot.primary.map { String($0.usedPercent) } ?? "none")")
        if let reset = snapshot.primary?.resetDescription { print("  primary.resetDescription: \(reset)") }
        if let loginMethod = snapshot.identity?.loginMethod { print("  identity.loginMethod: \(loginMethod)") }
        print("  dataConfidence: \(snapshot.dataConfidence.rawValue)")
        for section in snapshot.details {
            print("  [\(section.title ?? "untitled")]")
            for row in section.rows {
                print("    \(row.label): \(row.value)")
            }
            if let chart = section.chart {
                print("    chart: \(chart.kind.rawValue) \(chart.title ?? "-") \(chart.points.count) points, first \(chart.points.first?.label ?? "-"), last \(chart.points.last?.label ?? "-")")
            }
        }
    }
}
