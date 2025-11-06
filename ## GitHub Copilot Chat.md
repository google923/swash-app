## GitHub Copilot Chat

- Extension Version: 0.32.4 (prod)
- VS Code: vscode/1.105.1
- OS: Windows

## Network

User Settings:
```json
  "github.copilot.advanced.debug.useElectronFetcher": true,
  "github.copilot.advanced.debug.useNodeFetcher": false,
  "github.copilot.advanced.debug.useNodeFetchFetcher": true
```

Connecting to https://api.github.com:
- DNS ipv4 Lookup: 20.26.156.210 (26 ms)
- DNS ipv6 Lookup: Error (36 ms): getaddrinfo ENOTFOUND api.github.com
- Proxy URL: None (37 ms)
- Electron fetch (configured): HTTP 200 (24 ms)
- Node.js https: HTTP 200 (95 ms)
- Node.js fetch: HTTP 200 (180 ms)

Connecting to https://api.individual.githubcopilot.com/_ping:
- DNS ipv4 Lookup: 140.82.113.21 (27 ms)
- DNS ipv6 Lookup: Error (51 ms): getaddrinfo ENOTFOUND api.individual.githubcopilot.com
- Proxy URL: None (10 ms)
- Electron fetch (configured): HTTP 200 (141 ms)
- Node.js https: HTTP 200 (919 ms)
- Node.js fetch: HTTP 200 (368 ms)

## Documentation

In corporate networks: [Troubleshooting firewall settings for GitHub Copilot](https://docs.github.com/en/copilot/troubleshooting-github-copilot/troubleshooting-firewall-settings-for-github-copilot).