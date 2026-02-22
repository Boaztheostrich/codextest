# STL Face Painter (Browser Prototype)

A browser-based prototype that lets you:

- Upload an STL.
- Select 3 points on the mesh to define a drawing face/plane.
- Draw and type using **up to 4 colors**.
- Create inset extrusions that go **0.4 mm into the object**.
- Export everything as a `.3mf` with the base mesh + marks as **separate meshes** (not boolean-merged).

## Run on a MacBook

### 1) Install prerequisites

- A modern browser (Chrome, Edge, or Safari).
- Python 3 (used only to serve static files locally).

Check Python:

```bash
python3 --version
```

If needed, install with Homebrew:

```bash
brew install python
```

### 2) Download / clone this repo

```bash
git clone <your-repo-url>
cd codextest
```

### 3) Start a local web server

```bash
python3 -m http.server 4173
```

### 4) Open the app

Open this URL in your browser:

```text
http://localhost:4173
```

## Usage workflow

1. Upload an `.stl` file.
2. Click **Pick face (3 points)** and click 3 points on the STL surface.
3. Switch to **Draw** to paint inset marks or **Type** to place text.
4. Choose one of the 4 palette colors.
5. Click **Export .3mf** to download your model.

## Notes / troubleshooting

- Internet is required the first time because Three.js modules and font assets are loaded from `unpkg` CDN.
- If `python3` is not found, install Python and restart Terminal.
- If port `4173` is busy, use another port, e.g. `python3 -m http.server 8080`, then open `http://localhost:8080`.
- Draw mode stamps inset cylindrical marks onto the selected face plane.
- Type mode places inset text geometry at click position.
- This is currently a prototype focused on workflow and export behavior.
## Current status

- This branch contains the merged conflict-resolution and STL visibility fixes in one ready-to-review PR.

