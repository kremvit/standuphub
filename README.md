# StandupHub

Daily YouTube stand-up aggregator + rating + static site.

## Local run
```bash
export YT_API_KEY="YOUR_KEY"
pip install -r requirements.txt
python scripts/run_pipeline.py
# then open web/index.html (or run a local server)
python -m http.server 8000 --directory web
