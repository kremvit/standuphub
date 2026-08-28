# StandupHub

Daily YouTube stand-up aggregator + rating + static site.

## Add a performer
Add the performer to `performers.txt` and their YouTube channel to `channels.txt`, then push to `main`. GitHub Actions will run the pipeline, generate the performer page, and deploy the updated site. The `YT_API_KEY` repository secret must be configured.

## Local run
```bash
export YT_API_KEY="YOUR_KEY"
pip install -r requirements.txt
python scripts/run_pipeline.py
# Generate performer pages into generated/comedians/ before deploying
python scripts/gen_comedian_pages.py --base https://standuphub.com.ua --docs docs
# Copy generated pages to docs/ for clean performer URLs when deploying
cp generated/comedians/*.html docs/
# then open docs/index.html (or run a local server)
python -m http.server 8000 --directory docs
