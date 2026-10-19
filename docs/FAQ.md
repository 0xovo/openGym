# FAQ

Short answers, with a link to the long one.

### What does it cost?

Nothing. openGym is open source under the AGPL: no subscription, no paid tier, no ads. If you'd like
to support it anyway, there's [Buy Me a Coffee](https://buymeacoffee.com/duartesantos),
[Ko-fi](https://ko-fi.com/opengym) and [GitHub Sponsors](https://github.com/sponsors/DuarteSantos8),
also under Settings → About & updates in the app.

### Do I need my own server?

No, there are three ways to use it:

- **Try it:** the [online demo](https://opengym.ch/demo/) runs entirely in your
  browser with example data.
- **Phone only:** the iPhone and Android apps need no server and no account; everything stays on
  the phone.
  See [MOBILE.md](MOBILE.md).
- **Your own instance:** `docker compose up` on any machine with Docker gives you sync between
  devices and profiles for friends and family. See [SELF_HOSTING.md](SELF_HOSTING.md).

### Is there an iPhone app?

Yes, with an Apple Watch app, widgets and Apple Health. It is on its way into the App Store; until
it is listed there, the [public TestFlight beta](https://testflight.apple.com/join/RKATb61k) is the
same app. A self-hosted instance added to the home screen from Safari works too (a full PWA that
works offline). See [MOBILE.md](MOBILE.md).

### How do I use it on my iPhone right now?

As a web app, which takes a minute:

1. Open your openGym address in **Safari**. It has to be `https://` (see
   [the passkey question](#passkeys-dont-work-on-plain-http-or-my-laptop-has-no-fingerprint-reader)
   below); just looking around? The [demo](https://opengym.ch/demo/) works too, data stays in
   the browser.
2. **Share → Add to Home Screen.**
3. Open it from the new icon and create your profile. Face ID makes the passkey.

From the icon it runs full screen, works offline and can send notifications (iOS only allows web
push from a home-screen app, not from a Safari tab). The native App Store app is coming; when it
lands it can connect to the same server, so nothing you log now is wasted.

### Is it on Google Play?

It's coming: a new developer account has to run a closed test first (see the
[roadmap](../ROADMAP.md)). Until then the APK is the way in. It is signed, published with a
`.sha256` next to every release, and the app checks for updates itself. Get it from the
[latest release](https://github.com/DuarteSantos8/openGym/releases/latest).

### Where is my data?

On a self-hosted instance, in the `./data` folder next to `docker-compose.yml`: one JSON file per
profile plus the account list. Back up that folder and you've backed up everything. In the phone app
it's in the app's private storage. In guest mode it's only in that browser. You can export
everything as one file at any time under **Settings → Data & backup**.

### Does the app send anything anywhere?

Your instance has no telemetry and phones home to nobody. The exercise pictures and animations ship
inside the web image, so not even those are downloaded. The AI coach, if an admin turns it on, sends
the training data it needs to the provider you configured; [AI_COACH.md](AI_COACH.md) lists exactly
what. Push notifications go through your browser's push service, as all web push does.

### Was openGym written with AI?

It's developed with [Claude Code](https://claude.com/claude-code), Anthropic's coding agent, and a
large share of the code, tests and docs is drafted that way. The maintainer decides what goes in,
reviews it, and tests every release on a staging instance and on real phones. The longer answer is in
the [README](../README.md#how-opengym-is-built).

### Does the app itself use AI?

Only if you turn it on. The default install calls no AI service. Two optional pieces exist: the
[AI coach](AI_COACH.md) (off until an admin enables it, runs with your own provider key, every
change needs your approval) and the [MCP server](../mcp/README.md), which lets an AI client on your
computer read your history. Neither is needed for anything else in the app.

### My passkey sign-in doesn't work.

Almost always one of two things:

1. You're opening it over plain `http://` on a LAN address. Passkeys only work over HTTPS (or on
   `localhost`). Use guest mode, turn on password sign-in, or put it behind HTTPS.
2. `RP_ID` and `ORIGIN` in `.env` don't match the address in your browser exactly.

[SELF_HOSTING.md](SELF_HOSTING.md#2-understand-the-passkey-requirement-important) explains both, and
its troubleshooting section covers the rarer cases.

### I lost my phone and my passkey. How do I get back in?

Tap **Lost access?** on the sign-in screen. If your passkey was synced (iCloud Keychain, Google
Password Manager, a password manager), it still works on your other devices. If another device is
still signed in, it can give this one a passkey (**Settings → Account → Add another device**).
Otherwise ask whoever runs your server for a **recovery code**: entered under **I have a code**, it
gives your device a new passkey. Running the server yourself? `docker compose exec api node
recover.js "Your name"` prints one, the owner's included. Details in
[SELF_HOSTING.md](SELF_HOSTING.md#recovery-codes-when-every-way-in-is-gone).

### Passkeys don't work on plain http, or my laptop has no fingerprint reader.

Two separate things, both fixable:

- **Plain `http://192.168.1.20:8080` (or any `http://ip:port`).** Browsers only do passkeys over
  HTTPS, plus `http://localhost` on the machine itself. No setting in openGym changes that, and
  an SSH tunnel doesn't help unless the browser ends up on `localhost`. Put HTTPS in front:
  [SELF_HOSTING.md §3](SELF_HOSTING.md#3-expose-it-over-https-on-your-own-domain) for a domain or
  Tailscale Serve, [SELF_HOSTING_HTTPS.md](SELF_HOSTING_HTTPS.md) for a real certificate on a
  LAN-only address.
- **No fingerprint reader.** You don't need one. A passkey can live in lots of places: your phone
  (the browser shows a QR code, scan it, confirm on the phone), a password manager such as
  Bitwarden, 1Password or Proton Pass, a security key, or Windows Hello with a PIN. If the browser
  only ever asks for a fingerprint, look for "use another device" or "use a phone" in that dialog.
  Already signed in on your phone? **Settings → Account → Add another device** gives the laptop
  a passkey of its own. More in
  [which passkey providers work](SELF_HOSTING.md#which-passkey-providers-work).

Rather skip passkeys on that device? Put `PASSWORD_LOGIN=1` in `.env`, then `docker compose up -d`
(not `restart`). The sign-in screen then offers **Sign in with password**, and **Create new
profile** can use a password instead of a passkey. A profile you already made with a passkey gets
its password under **Settings → Account → Password**, confirmed with that passkey once. Over plain
http the password crosses your network unencrypted, so keep that to a network you trust.

### Can I use a password instead of a passkey?

Yes, if the instance allows it: set `PASSWORD_LOGIN=1`. It's off by default. See
[password sign-in](SELF_HOSTING.md#password-sign-in-optional).

### Can several people use one instance?

Yes. Everyone creates their own profile and sees only their own data. You can make signup
invite-only and give yourself an admin dashboard; see
[multiple users](SELF_HOSTING.md#4-multiple-users).

### The AI Coach doesn't show up on my server.

There's no setting in `.env` that turns it on: an admin switches it on in the app. So the usual
missing piece is that nobody is admin yet (`FIRST_USER_ADMIN` is off by default). If **Settings →
Account → Admin dashboard** isn't there for you:

1. Copy your id from **Settings → Account → Account ID**, put `ADMIN_UIDS=<that id>` in `.env`,
   run `docker compose up -d` (not `restart`) and reload the app.
2. **Admin dashboard → AI Coach → Set up the Coach**: pick a provider, paste the key (or a local
   model's address), **Test the Coach**, and make sure the switch at the top of the card is on.
3. The Coach is the last entry in the menu at the top right of **Plan**.

API-key providers and local models run on the normal image; `API_TARGET=coach` is only for the
Claude Agent SDK and Codex. The full walk-through is in
[AI_COACH.md](AI_COACH.md#from-zero-to-a-working-coach-self-hosted).

### How do I serve it under a subpath like `/gym` with nginx?

Two working setups, pick one: nginx passes `/gym/` through to the container and `.env` has
`BASE_PATH=/gym`, or nginx strips it (`proxy_pass http://127.0.0.1:8080/;`, trailing slash) and
`BASE_PATH` stays empty. Never both. `ORIGIN` is just `https://example.com`, no `/gym`, and leave
out `proxy_cookie_path`: it breaks the session cookie over https. Copy-paste configs for both, and
what each mistake looks like, are in
[SELF_HOSTING.md](SELF_HOSTING.md#nginx-under-gym-both-ways).

### Can I move my data from the phone app to my own server?

Yes, two ways:

- **Connect the app to the server** (the easy one). On the server's website, in a browser where
  you're signed in: **Settings → Account → Pair the mobile app**. In the phone app: **Settings →
  Account → Connect to my server**, enter the address and the code. The app asks whether to add
  this device's workouts to your profile; say **Add them**. From then on the phone syncs with the
  server. See [MOBILE.md](MOBILE.md#connecting-the-app-to-your-own-server).
- **Export and import a file.** In the phone app: **Settings → Data & backup → Export backup
  (JSON)** (or the .zip, if your own exercises have photos). On the server, signed in: **Settings →
  Data & backup → Import backup**. If the profile there already has workouts the file doesn't,
  it asks whether to replace or merge them in.

### How do I update?

`git pull && docker compose pull && docker compose up -d`. Your data is untouched. See
[updating](SELF_HOSTING.md#8-updating).

Then update the app on every device that syncs. A phone still on v1.3.9 or older keeps syncing,
and the server looks after what that phone doesn't know about, but it can't always tell what the
phone has seen. One case it gets wrong on purpose: if the old phone sets something back to exactly
what it was before, after another device changed it, the other device's change wins. Once every
device is updated, nobody has to guess.

### I'm moving from another app. Can I bring my history?

FitNotes, Strong and Hevy work out of the box, Apple Health for body weight, and any CSV with a date,
an exercise and something measured. See [DATA_IMPORTS.md](DATA_IMPORTS.md).

### Can I reuse the exercise images in my own project?

No. They are © Aliaksandr Makatserchyk, Gym visual, licensed for use in openGym only and not covered
by openGym's license. Anything outside openGym needs your own licence from
[gymvisual.com](https://gymvisual.com/). Details in [NOTICE.md](../NOTICE.md). The exercise text in
[catalogue/](../catalogue/README.md) is a different story: that's openGym's, and fixes are welcome.

### Where do I ask something that isn't here?

The [Discord](https://discord.gg/e62jY6fwVb) for a quick answer,
[Discussions](https://github.com/DuarteSantos8/openGym/discussions) if the next person should be
able to find it, [Issues](https://github.com/DuarteSantos8/openGym/issues) for a bug.
