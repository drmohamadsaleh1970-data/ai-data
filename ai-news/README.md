# AI NEWS — Arabic virtual news anchor proof of concept

A Google Colab notebook that takes **a portrait + an Arabic text script**, generates an Arabic synthetic voice using Edge TTS and attempts lip synchronization with **MuseTalk 1.5** on a Colab T4 GPU. No personal voice recording is required.

## Run

Open in Colab: https://colab.research.google.com/github/drmohamadsaleh1970-data/ai-data/blob/ai-news-musetalk-demo/ai-news/AI_NEWS_MuseTalk_Arabic_Anchor.ipynb

1. Select **Runtime → Change runtime type → T4 GPU** (subject to availability).
2. **Run all**. Upload the portrait if prompted. Arabic audio is generated automatically from the script.
3. Wait for the MP4 download. First run may take 10–25 minutes or longer.

## Caveats

- This is an **unexecuted prototype**: code committed and structurally checked, but not run on a GPU.
- Colab is controlled by the user's Google session, not GitHub. A signed-in user must start it.
- Edge TTS is an unofficial public client; quality and availability are not guaranteed. For production replace with Google Cloud TTS.
- MuseTalk is open source and commercially permitted per its own README; verify third-party model licenses.
- Wav2Lip fallback is disabled because its license is noncommercial.
- Always label synthetic anchors as AI-generated. Never imply the presenter is a real news reporter.

Based on https://github.com/htunh/free-lipsync-colab and https://github.com/TMElyralab/MuseTalk.
