# NTS Player data

Generated files, not edited by hand. `charts/` holds "Most played on NTS": one JSON file
per month and `recent.json` (the last 30 days), worked out from every episode's
tracklist by `scripts/build-charts.js` on the main branch, and updated daily by the
Charts workflow. The app downloads these instead of reading tracklists itself.
