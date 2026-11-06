# Vosk: speech recognition on the device

The speech check can recognize speech with [Vosk](https://alphacephei.com/vosk/), which runs inside the page instead of sending audio anywhere. Both files are under the Apache License 2.0 (`LICENSE`).

- `vosk.js`: [vosk-browser](https://github.com/ccoreilly/vosk-browser) 0.0.8 from npm (`dist/vosk.js`), with one change. Its web worker posts `{ event: "progress", loaded, total }` while it downloads a model, so the page can show how far along it is. The worker is stored inside `vosk.js` as base64. The change is one `self.postMessage(...)` added after `bytesWritten=bytesWritten+value.length;` in `writeStreamToFile`.
- `vosk-model-small-en-us-0.15.tar.gz`: Alpha Cephei's small US English model, [vosk-model-small-en-us-0.15.zip](https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip) (41,205,931 bytes, SHA-256 `30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498`), repacked unchanged as a `.tar.gz` with its top folder, because vosk-browser only reads `.tar.gz` archives.

How vosk-browser handles the model:

- Its worker downloads the archive, unpacks it, and keeps it in the browser's IndexedDB, filed under the model's URL. After the first time it loads from there, even offline.
- Give it a full URL. The worker runs from a `blob:` address, so it reads a relative URL from the site's root folder, not from this app's folder.
- `Vosk.createModel()` never settles if loading fails. `listen.js` makes a `Vosk.Model` itself and listens for both `load` and `error`.
- A recognizer made with a grammar (`new model.KaldiRecognizer(sampleRate, '["word", "[unk]"]')`) only hears those words. `[unk]` stands for anything else. Words the model doesn't know are left out.
