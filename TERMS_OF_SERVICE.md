# SiR System Monitor Terms of Service

**Effective date:** 23 July 2026  
**Last updated:** 23 July 2026

These Terms of Service (“Terms”) cover the official SiR System Monitor desktop application, its Web Monitor, on-screen display, diagnostics and support features, and its optional Discord Rich Presence integration (together, the “Application”). SiR System Monitor is maintained by **SiR_KaMiKaZeE** (“we”, “us”, or “the maintainer”).

## 1. Open-source licence

SiR System Monitor is free and open-source software distributed under the [GNU General Public License version 3](./LICENSE.txt) (“GPLv3”). Your rights to receive, run, study, modify, and redistribute GPL-covered code are governed by GPLv3. You do not need to accept these Terms merely to receive or run a GPL-covered copy, and these Terms do not reduce or replace rights granted by GPLv3.

These Terms describe the official Application, optional integrations, documentation, update channel, and support resources. Third-party components remain subject to their own licences and terms.

## 2. What the Application does

The Application reads and displays system and hardware information on a Windows computer. Depending on the features you enable, it may:

- use bundled standard or enhanced hardware collectors;
- install or use a bundled low-level hardware-access driver with administrator approval;
- display an overlay, alerts, diagnostics, and locally stored profiles;
- serve selected readings through a local Web Monitor;
- check GitHub for releases and download an update at your request;
- look up the computer’s public IP address;
- probe a host selected for latency monitoring; and
- publish an activity status through the locally running Discord desktop client.

Feature availability and sensor accuracy vary by hardware, firmware, drivers, Windows configuration, permissions, and third-party software.

## 3. Discord Rich Presence

Discord Rich Presence is an optional integration. When enabled, the Application asks the local Discord desktop client to display that you are using SiR System Monitor, together with basic activity details such as the Application version and session duration.

The integration:

- does not provide multiplayer, matchmaking, joining, or shared-party functionality;
- does not read your Discord account, friends, messages, servers, or access token;
- does not give the maintainer an active-user list or global “player” count; and
- can be disabled in the Application settings.

Your use of Discord is also governed by the [Discord Terms of Service](https://discord.com/terms), [Discord Privacy Policy](https://discord.com/privacy), and any other Discord terms that apply to your account. SiR System Monitor is not endorsed by, sponsored by, or affiliated with Discord Inc.

## 4. Web Monitor and network access

The Web Monitor is disabled by default and binds to the local computer by default. If you expose it to a local network or another interface, you are responsible for:

- using it only on networks and devices you trust;
- enabling an access token where appropriate;
- protecting the token and any browser URL that contains it;
- configuring firewalls and routers safely; and
- ensuring that people who can view the monitor are authorised to see the displayed system data.

The Web Monitor uses unencrypted HTTP. Do not expose it directly to the public Internet. The maintainer does not host, relay, or control your Web Monitor traffic.

## 5. Your responsibilities

You are responsible for:

- having permission to monitor and administer the computer on which the Application runs;
- reviewing administrator and driver-installation prompts before approving them;
- keeping your system, drivers, firmware, and security controls up to date;
- protecting exported profiles, diagnostics, support bundles, and Web Monitor credentials; and
- independently verifying readings before relying on them for overclocking, thermal, electrical, safety-critical, commercial, or other consequential decisions.

You must not use the official integrations or support resources unlawfully, to access systems without permission, to interfere with third-party services, or to misrepresent an affiliation with the maintainer.

## 6. Third-party services

Optional or network-connected features may interact with Discord, GitHub, ipify, jsDelivr, a latency target you configure, and software or hardware vendors. Those services are operated independently and may change, fail, restrict access, or process request data under their own terms and privacy policies. We are not responsible for third-party services.

## 7. Updates, changes, and availability

We may add, change, suspend, or remove Application features or integrations. We may publish security, compatibility, or maintenance updates, but do not promise a particular update schedule or perpetual availability. You control whether to install an available update.

## 8. No warranty

To the fullest extent permitted by law, the Application and related resources are provided **“as is” and “as available”**, without warranties of any kind. Hardware readings may be incomplete, delayed, unsupported, or incorrect. The Application is a general-purpose monitoring tool and is not designed as a safety system, emergency system, medical device, or certified industrial control.

The warranty disclaimer in GPLv3 also applies to GPL-covered software. Nothing in these Terms excludes warranties, guarantees, or remedies that cannot lawfully be excluded, including applicable rights under the Australian Consumer Law.

## 9. Limitation of liability

To the fullest extent permitted by law, the maintainer and contributors are not liable for indirect, incidental, special, consequential, or punitive loss arising from the Application, including loss caused by inaccurate readings, unavailable sensors, system changes, network exposure, data loss, downtime, or third-party services.

Where liability cannot lawfully be excluded, it is limited only to the extent permitted by applicable law. Nothing in this section limits a non-excludable statutory right or remedy.

## 10. Ending use

You may stop using the Application at any time by disabling optional integrations, stopping the Web Monitor, or uninstalling the Application. Uninstalling may not remove exported files or all data retained in the Windows application-data directory.

## 11. Changes to these Terms

We may update these Terms when the Application, its integrations, or legal requirements change. The date at the top identifies the current version. Material changes will be published in this repository.

## 12. Governing law

These Terms are governed by the laws of South Australia, Australia, subject to any mandatory laws and consumer protections that apply where you live.

## 13. Contact

For questions about these Terms, open an issue in the [SiR System Monitor GitHub repository](https://github.com/KaMiKaZeE1221/SiR-System-Monitor/issues). Do not post private or sensitive information in a public issue.
