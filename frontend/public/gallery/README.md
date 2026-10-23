# Gallery images

- `../photos/` holds the owner's real photos, exported for the web: rotation fixed, all EXIF/GPS metadata
  removed, resized to at most 1,200 px (the hero is 1,800 px) and compressed (about 2.4 MB in total).
- This folder holds illustrated "concept" designs for cakes that haven't been photographed yet. The site labels
  them "Illustrated idea", and the Order Taker never presents them as real work.

To add a photo, save it in `../photos/` and add a row to `GALLERY` in `backend/seed.py` with
`kind="photo"`. The catalog syncs into the database on the next server start, without wiping orders.
