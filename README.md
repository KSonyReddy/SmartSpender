# Budget AI — Final (Cleaned)

This repository has been cleaned per the project owner's request. All auxiliary Markdown documentation files were removed; this consolidated README remains as the single documentation file.

What changed
- Removed all `.md` documentation files except this `README.md`.
- Removed external geocoding utilities and fallbacks. The codebase now uses vendor coordinates from the database and a local `CITY_COORDS` table where applicable.

Quick start
1. Install dependencies:

```bash
npm install
```

2. Start the server (development):

```bash
npm run dev
```

Notes
- If you rely on text-based place searches (free-text `place` parameter), the server will not resolve those to coordinates anymore — provide `lat`/`lon` in requests when you need distance-based filtering.
- To re-enable external geocoding, restore `backend/utils/geocodingCache.js` and set `GOOGLE_MAPS_API_KEY` in your `.env`.

Next steps
- Run the server and report any runtime errors so they can be fixed.

Contact
- Ask the maintainer (or me) to run verification and patch runtime issues.

## License

License information (if any) from the original project applies.
