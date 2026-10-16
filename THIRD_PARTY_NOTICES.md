# Third-party notices

Application code is original to this project. The following third-party libraries are bundled or used at build time; their upstream licenses remain applicable.

- React — MIT — https://github.com/facebook/react
- Three.js — MIT — https://github.com/mrdoob/three.js
- three-mesh-bvh — MIT — https://github.com/gkjohnson/three-mesh-bvh
- occt-import-js 0.0.23 — LGPL-2.1 — https://github.com/kovacsv/occt-import-js
- Open CASCADE Technology, as bundled by occt-import-js — LGPL-2.1 with OCCT exception — https://dev.opencascade.org/
- ExcelJS — MIT — https://github.com/exceljs/exceljs
- jsPDF — MIT — https://github.com/parallax/jsPDF
- Lucide — ISC — https://github.com/lucide-icons/lucide
- @xmldom/xmldom — MIT — https://github.com/xmldom/xmldom

The unmodified occt-import-js JS/WASM artifacts are supplied through the npm package pinned in package-lock.json. Upstream source, dependency versions and build instructions are available in its linked source repository and version history. The CAD importer is a separately bundled module; rebuilding the application can replace it with a modified compatible build.

Copies of the included OCCT/importer license texts are distributed with the site under licenses/. Other dependencies retain their license headers and package license files. Exact installed versions are recorded in package-lock.json.
