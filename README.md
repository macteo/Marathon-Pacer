# Marathon-Pacer

A tiny, mobile-friendly web app to plan running paces by **segments** and **repeats**, with automatic totals for any target distance (5K, 10K, Half, Marathon, or custom).

## Features

- Add **segments** with distance (km) and pace (min'sec" per km).
- Create **repeat groups**: put several segments inside and repeat them N times.
- Pick a **target distance** (preset or custom). The app computes the **remaining distance** to reach it and asks only for the final pace.
- **Total time**, **total distance** and **average pace** update live.
- **Local storage** persistence — your plan stays in your browser.
- **Mobile-first** UI, dark mode aware, no build step.

## Example

- Segment: 2 km at 4'25"/km
- Segment: 2 km at 4'45"/km
- Repeat the two segments above **10×**
- Final segment: the app suggests **2.195 km** remaining → fill 4'20"/km → done.

## Run locally

Just open `index.html` in a browser. No dependencies, no build.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy on GitHub Pages

1. Push to the `main` branch.
2. In the repo settings → **Pages**, set the source to `Deploy from a branch`, branch `main`, folder `/ (root)`.
3. The app will be served at `https://<user>.github.io/Marathon-Pacer/`.

The `.nojekyll` file ensures GitHub Pages serves the files as-is.

## License

MIT — see [LICENSE](LICENSE).
