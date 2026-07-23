# SiR System Monitor Privacy Policy

**Effective date:** 23 July 2026  
**Last updated:** 23 July 2026

This Privacy Policy explains how the official SiR System Monitor desktop application, Web Monitor, diagnostics, support features, and optional Discord Rich Presence integration (together, the “Application”) handle information. SiR System Monitor is maintained by **SiR_KaMiKaZeE** (“we”, “us”, or “the maintainer”).

## Privacy at a glance

- The Application has no user account system, advertising, or maintainer-operated telemetry service.
- Hardware readings, settings, profiles, and alert rules are processed and stored locally.
- The maintainer does not automatically receive your readings, hardware inventory, IP address, diagnostics, Discord identity, or usage history.
- Specific features make the network requests described below.
- Diagnostics, profile exports, and support bundles are created locally and leave your computer only when you choose to share them.

Because the Application does not report launches to a maintainer-operated service, the maintainer cannot use it to identify active users or calculate a global live-user count.

## 1. Information processed locally

The Application may process the following information on your computer:

- hardware and operating-system information, sensor names, values, availability, and timing;
- CPU, GPU, memory, storage, network, power, fan, temperature, voltage, FPS, frame-time, latency, process, and Application-performance readings;
- local and public IP address readings;
- enabled sensors, custom sensor names, card order and size, themes, colours, layouts, animation settings, overlay configuration, alert rules, and refresh rates;
- saved profiles and profile exports;
- Web Monitor host, port, access settings, and access token;
- startup, tray, administrator, update, and Discord Rich Presence preferences; and
- diagnostic results, logs, error messages, and support-bundle content generated at your request.

Most preferences and profiles are stored in Electron browser storage in the Application’s Windows user-data directory. Some startup and behaviour settings are also stored in a local JSON file. This data is used to provide the features you configure and is not automatically uploaded to the maintainer.

## 2. Network-connected features and third parties

The following features may send limited information to another device or provider:

| Feature | When it is used | Information sent or exposed | Recipient |
|---|---|---|---|
| **Discord Rich Presence** | Enabled by default; you can disable it in settings | Application identity, activity text, version, session start time, image asset keys, and project link | Your local Discord desktop client, which may publish the presence through Discord |
| **Update checks and downloads** | Automatic checks when enabled, manual checks, or downloads you start | Current Application version and ordinary connection/request data such as IP address and user agent | GitHub |
| **WAN IP sensor** | While built-in sensor monitoring is running; successful readings are normally refreshed every ten minutes | A request whose source address is your public IP; the service returns that address | `api.ipify.org` |
| **Interface icons** | When the desktop interface or Web Monitor loads Bootstrap Icons and the resource is not already cached | Ordinary web request data such as IP address, user agent, requested file, referrer, and time | jsDelivr and its CDN providers |
| **Latency monitoring** | While Application monitoring is running, whether or not the Ping card is currently visible | Network probe packets sent to the host you configure; the default target is `1.1.1.1` | The configured host and intervening network providers |
| **Web Monitor** | Only when you enable its service | Selected sensor readings, display names, layout and theme data, and Web Monitor responses | Browsers or API clients that connect to the address you configured |
| **External links** | Only when you open a project, update, or other external link | Ordinary browser request data | The destination website |

These providers independently control information they receive. Their policies include the [Discord Privacy Policy](https://discord.com/privacy) and [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The ipify and jsDelivr services are described at [ipify.org](https://www.ipify.org/) and [jsdelivr.com](https://www.jsdelivr.com/).

The Application does not sell personal information and does not use this information for cross-context behavioural advertising.

## 3. Discord integration details

Discord Rich Presence communicates with the Discord desktop client through a local inter-process communication pipe. The Application sends presence information but does not request or read your Discord user ID, username, email address, friends, messages, servers, OAuth token, or other Discord account content.

Discord decides how presence is displayed and may process it according to your Discord account and privacy settings. You can stop future presence updates by turning off **Discord Rich Presence** in SiR System Monitor. You can also control activity sharing in Discord.

The integration does not send the maintainer a list or count of people using the Application.

## 4. Web Monitor

The Web Monitor is disabled by default and uses `127.0.0.1` (the local computer) by default. You may deliberately bind it to a LAN address or all network interfaces. Connected browsers receive the readings and names selected for display.

The Web Monitor uses unencrypted HTTP. Optional token protection restricts access but does not encrypt traffic. A token included in a browser URL may appear in local browser history. Use a trusted network, enable token protection when appropriate, and do not forward the service directly to the public Internet.

The browser view stores its Summary-mode preference in that browser’s local storage. The maintainer does not receive that preference.

## 5. Diagnostics, exports, and support bundles

Diagnostics run locally. Creating a support bundle runs the listed diagnostic checks and writes a ZIP archive to a location you choose. The bundle is designed to redact user and computer names, user-profile paths, IP and MAC addresses, email addresses, host names, access tokens, passwords, credentials, and custom sensor names.

Automated redaction cannot guarantee removal of every sensitive value. Review a support bundle, diagnostic result, screenshot, or exported profile before sharing it. Once you send a file to GitHub, Discord, email, or another service, that service’s privacy practices apply.

## 6. Retention and deletion

Local settings remain until you change or delete them, clear the Application’s data, or remove the relevant Windows user-data directory. Exported profiles, screenshots, logs, diagnostics, and support bundles remain wherever you saved them until you delete them. Uninstalling the Application may leave user settings and exported files in place.

The maintainer normally has no server-side Application record to delete because the Application does not upload one. Third parties may retain request or account data under their own policies.

## 7. Security

We use local processing and feature-specific data minimisation to reduce unnecessary disclosure. No software or storage method is completely secure. Administrator access, low-level sensor drivers, network binding, and files shared for support should be used carefully.

If you believe you found a security or privacy issue, contact the maintainer through the repository without publicly posting sensitive details.

## 8. Children’s privacy

The Application is not directed to children and does not knowingly operate a service that collects children’s personal information. Discord and other third-party services apply their own age requirements.

## 9. Your choices and rights

You can:

- disable Discord Rich Presence, automatic update checks, the Web Monitor, enhanced sensors, or individual sensor categories;
- change or remove locally stored settings and profiles;
- choose whether to create or share diagnostics, exports, and support bundles; and
- use Discord and browser privacy controls for data those services process.

Privacy rights vary by location. Because the maintainer normally does not possess Application usage records about you, a request may need to be directed to the third party that received the information.

## 10. Changes to this Policy

We may update this Policy when Application behaviour, third-party integrations, or legal requirements change. The date at the top identifies the current version. Material changes will be published in this repository.

## 11. Contact

For privacy questions, open an issue in the [SiR System Monitor GitHub repository](https://github.com/KaMiKaZeE1221/SiR-System-Monitor/issues). Do not post private or sensitive information in a public issue.
