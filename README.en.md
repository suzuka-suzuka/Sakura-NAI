# Sakura NAI

<p align="center">
  <img src="assets/brand/sakura-banner.png" alt="Sakura NAI — Your ideas, in full bloom." width="100%" />
</p>

[简体中文](README.md) · **English**

A cherry blossom themed studio for NovelAI image generation. Prompts, characters, generation settings, and a local gallery share one workspace, so every image can begin with a simple idea.

Run Sakura NAI locally on Windows or host it on a Linux server. The browser calls the selected NovelAI official or Sakura relay API through an application-owned request and response layer, without a NovelAI SDK. This independent, unofficial client requires a key and account access for the selected service.

## Features

- **V5-focused generation:** NAI Diffusion V5 Full / Curated, plus V4.5, V4, Anime V3, and Furry V3. V5 Full is the default.
- **Prompts and characters:** separate or combined positive/negative editors, tag suggestions, and a clear button for each prompt. Characters offer female, male, and other options with automatic or custom placement. V5 allows up to 22 characters; V4 models allow up to 6.
- **Quality and negative presets:** standard, light, or disabled quality tags, with model-specific negative presets and hover previews. V5 also supports transparent backgrounds.
- **Direct parameter editing:** steps, guidance, seed, sampler, dimensions, batch size, random seed, and a reset action.
- **Optional streaming:** the preview follows the image aspect ratio. With streaming disabled, the previous image stays visible until completion; the first generation waits on a blank canvas.
- **Anlas display:** costs appear on the generation button and relevant image tools. An optional confirmation appears when switching from free to paid generation. Calculations use account status; API-side billing is authoritative.
- **Image workflows:** image-to-image, inpainting, enhancement, variations, 2× upscaling, and image tools. Enhance shows strength/noise by default, offers five magnitude levels in advanced settings, and supports V5 Max; sidebar settings remain editable and pricing follows the effective enhancement request. Reference and Vibe Transfer support depends on the model; V5 currently does not support Vibe or precise references.
- **Local gallery:** a single-column history, fullscreen previews, PNG downloads, ZIP export, and undo for deletion. Selecting an image previews it; reusing its parameters is a separate action. Import parameters from NovelAI PNGs.
- **Image and mask editors:** wheel zoom anchors at the pointer and Space/middle-button drag pans. Round/square brushes keep a constant size on screen, with strokes matching the cursor outline. Expanding the image editor keeps Image2Image mode; expanding the mask editor automatically selects new space for outpainting. Layers, masks, and dimensions support undo/redo. Inpainting output resolution remains editable.
- **Focused inpainting and Variety+:** generate details around a mask at the selected resolution and composite them into the full source, keeping unmasked pixels intact. Pricing uses the detail request dimensions. V4.5 and earlier models expose Variety+ without an extra charge; V5 hides it.
- **Ordinary image imports:** drop or choose PNG, JPEG, WebP, and other browser-supported images without metadata as a base, preserving current prompts. NovelAI PNGs still restore their generation settings. Imports and local edits consume no Anlas.
- **Sakura identity:** a five-petal blossom, pink light mode, warm plum dark mode, Chinese/English UI, and alternate accent colors. Persistent desktop controls and mobile drawers.

The empty canvas offers **Girl among blossoms**, **Sakura Miko**, and **Moonlit blossoms**. The Sakura Miko example uses the character tags `sakura miko, hololive`. Clicking an example **replaces the entire main positive prompt**, without generating an image or changing negative prompts and character settings.

## Run locally

Install Bun and Node.js 22 or later, and use a modern browser with IndexedDB support. Download or clone this repository, then run these commands from its root:

```bash
git clone https://github.com/suzuka-suzuka/Sakura-NAI.git
cd Sakura-NAI
bun install --frozen-lockfile
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). The **Key type** dropdown offers **Sakura key**, **NovelAI official key**, and **Custom connection**. New users start with Sakura selected; saved connections restore their original type, and unavailable Sakura configuration defaults to the official key. Official and Sakura choices set their host automatically; enter custom hosts under advanced connection settings. Each type keeps a separate key in the current form, so switching never reuses another service's credentials. Custom hosts must support the NovelAI endpoints used by this client and allow browser requests through CORS.

The Sakura host is read from `connection.config.json` in the project root:

```json
{
  "sakura": {
    "url": "https://relay.tenshimomone.com/"
  }
}
```

Edit `sakura.url` and refresh the page to use the new host when selecting Sakura, without rebuilding or restarting. Saved connections keep their original address; reselect Sakura and enter the matching key to switch. This file contains only a public host address, never credentials. Missing or invalid configuration disables Sakura while official and custom connections remain available. Set the runtime environment variable `SAKURA_CONFIG_FILE` to an absolute path to load a different file. The Windows launcher points to the project-root file, and Docker Compose mounts it read-only.

Official, Sakura, and custom hosts are verified through `/user/subscription`, which also loads account allowances. The UI shows **Connected** only after receiving valid account data and verifies again on reload. Invalid or disabled keys prompt you to reconnect. Network errors, rate limits, service failures, or unsupported account queries show **Unverified** and keep your configuration available for retry.

If only Node.js is installed, you can invoke Bun through npm to install dependencies:

```bash
npm exec --yes --package=bun -- bun install --frozen-lockfile
npm run dev
```

The interface initially follows your browser language and remembers your selection. Change languages from the menu or connection dialog. The default repository README is [Chinese](README.md); this file is the English edition.

### Windows production build

```powershell
npm run build
.\start-local.cmd
```

The launcher prepares standalone static assets and binds to **127.0.0.1:3000**. Open [http://127.0.0.1:3000](http://127.0.0.1:3000); press Ctrl + C in the terminal to stop. Rebuild and restart after source changes, or use `npm run dev` during development.

See [LOCAL-DEPLOY.md](LOCAL-DEPLOY.md) for additional local instructions in Chinese.

## Deploy on Linux

The repository includes a multi-stage Dockerfile and Docker Compose configuration. With Docker Engine and the Compose plugin installed, run:

```bash
docker compose up -d --build
docker compose logs -f web
```

The application is exposed on the server's **port 8080**, mapped to container port 3000. The image runs a Next.js standalone server as a non-root user with a health check. Run the first command again after updating the source to rebuild.

For a public domain, point an HTTPS reverse proxy at the exposed port. Set `SITE_URL` to override the public origin used in social metadata:

```bash
SITE_URL=https://sakura.example.com docker compose up -d --build
```

Without Docker:

```bash
bun install --frozen-lockfile
bun run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Keep the process running with systemd or another process manager, then place a reverse proxy in front of it. This command binds to the server's loopback interface; Docker Compose exposes port 8080 by default.

The server serves the web application. **Generation requests still originate in the user's browser**; hosting the application does not automatically proxy NovelAI through the server. User tokens do not need to be configured as server environment variables.

During builds, `next/font` downloads Google Fonts, so the build environment needs access to that service. Fonts are served with the application at runtime.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| **Ctrl + K** | Open the command palette for commands, models, and gallery search |
| **Ctrl + Enter** | Generate using the current settings |
| **Esc** | Close the active dialog, fullscreen preview, or mobile drawer |
| **[** | Toggle the mobile settings drawer |
| **]** | Toggle the gallery |
| **← / →** | Navigate images in fullscreen preview |
| **+ / − / 0** | Zoom in, zoom out, or fit the fullscreen image |

On macOS, Command also works in place of Ctrl. Brackets do not toggle panels while you are typing in an editor. Click the empty area outside the image to exit fullscreen preview.

## Data and storage

| Data | Location |
| --- | --- |
| API token, host, settings, and preferences | Browser localStorage |
| Generated images and their generation settings | Browser IndexedDB |
| Prompts, reference images, and generation requests | Sent directly to NovelAI or the configured API host |
| Application shell and static assets | Your local service or deployed server |

The gallery does not synchronize across browsers or devices. Different domains, ports, or browsers have separate storage. Clearing site data also removes the local gallery; download images you want to keep.

Internal storage keys and the gallery database name are retained from earlier versions so existing data survives upgrades. The product name and new download filenames use Sakura. A custom host receives your token and request contents, so use a service you trust.

## Development

Built with **Next.js 16, React 19, TypeScript, Tailwind CSS 4, Zustand, and IndexedDB**.

| Directory | Responsibility |
| --- | --- |
| `app/` | Entry points, theme tokens, icons, and social metadata |
| `components/sidebar/` | Prompts, characters, parameters, and settings |
| `components/canvas/` | Welcome screen, previews, image editor, and tools |
| `components/gallery/` | Local history and image actions |
| `lib/nai/` | Models, payloads, transport, image decoding, and cost calculation |
| `lib/db/` | IndexedDB gallery |
| `lib/i18n/` | Chinese and English UI copy |
| `assets/brand/` | Sakura SVG source artwork, icons, and README banner |
| `tests/` | Request, pricing, image, and storage tests |

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Implementation notes are available in [NAI V5](docs/NAI-V5.md) and the [UI verification log](docs/OFFICIAL-UI-AUDIT.md), both in Chinese. Parameters, image tools, and streaming capabilities vary by model; use the options offered by the interface.

## License and acknowledgments

Released under the [MIT License](LICENSE). Sakura NAI is derived from [NyaNovel](https://github.com/Nya-Foundation/NyaNovel) and retains its original copyright notice. Pricing logic references [Aaalice_NAI_Launcher](https://github.com/Aaalice233/Aaalice_NAI_Launcher); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and licenses.

The Sakura blossom and theme artwork are in [assets/brand](assets/brand/README.md). This project is not affiliated with or endorsed by NovelAI.
