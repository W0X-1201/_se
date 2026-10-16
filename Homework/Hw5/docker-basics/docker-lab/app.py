from flask import Flask
import socket

app = Flask(__name__)


@app.get("/")
def index():
    return {
        "message": "Hello from Docker!",
        "hostname": socket.gethostname(),
    }


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
