import os

import uvicorn

from server import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("GRADIO_SERVER_PORT", 7860)))
