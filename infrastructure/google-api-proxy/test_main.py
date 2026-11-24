"""
Offline tests for the Google API relay (main.py). Google is mocked, so no credentials or
network are needed.

Run:  uv run --with-requirements requirements.txt --with flask python -m unittest test_main.py
  or: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m unittest test_main.py

@author CyberChefCloud
@copyright Crown Copyright 2026
@license Apache-2.0
"""

import base64
import json
import unittest
from unittest import mock

import flask

import main

app = flask.Flask(__name__)
ORIGIN = "https://andy7475.github.io"


def call(payload=None, token="Bearer good", method="POST", origin=ORIGIN):
    """Calls the relay as the browser would and returns (status, json, headers)."""
    headers = {"Origin": origin}
    if token:
        headers["Authorization"] = token
    with app.test_request_context("/", method=method, headers=headers,
                                  data=json.dumps(payload) if payload is not None else None,
                                  content_type="application/json"):
        result = main.handle(flask.request)
    body, status, resp_headers = result
    return status, body, resp_headers


def iam(permissions):
    """A fake testIamPermissions response."""
    resp = mock.Mock(ok=True)
    resp.json.return_value = {"permissions": permissions}
    return resp


def google(status=200, content=b'{"ok":true}', content_type="application/json"):
    """A fake Google API response."""
    return mock.Mock(status_code=status, content=content, headers={"Content-Type": content_type})


class RelayTests(unittest.TestCase):
    """The relay's checks and forwarding."""

    def setUp(self):
        main._allowed_tokens.clear()

    def test_preflight(self):
        status, _, headers = call(method="OPTIONS", token=None, origin="http://localhost:8080")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:8080")
        self.assertIn("Authorization", headers["Access-Control-Allow-Headers"])

    def test_no_token_is_refused(self):
        status, body, _ = call({"url": "https://vision.googleapis.com/v1/x"}, token=None)
        self.assertEqual(status, 403)
        self.assertIn("Not authorised", body["error"])

    @mock.patch("main.requests.post", return_value=iam([]))
    def test_token_without_project_access_is_refused(self, _post):
        status, _, _ = call({"url": "https://vision.googleapis.com/v1/x"})
        self.assertEqual(status, 403)

    @mock.patch("main.requests.request")
    @mock.patch("main.requests.post", return_value=iam(["run.routes.invoke"]))
    def test_only_googleapis_hosts(self, _post, upstream):
        for url in ["https://example.com/x", "http://vision.googleapis.com/x", "https://googleapis.com.evil.com/x",
                    "https://user:pw@vision.googleapis.com/x", "https://vision.googleapis.com:8443/x", "not a url"]:
            status, body, _ = call({"url": url})
            self.assertEqual(status, 400, url)
            self.assertIn("googleapis.com", body["error"])
        upstream.assert_not_called()

    @mock.patch("main.requests.request", return_value=google())
    @mock.patch("main.requests.post", return_value=iam(["run.routes.invoke"]))
    def test_forwards_text_request_and_selected_headers(self, _post, upstream):
        status, body, _ = call({
            "url": "https://speech.googleapis.com/v1/speech:recognize", "method": "post",
            "headers": {"Authorization": "Bearer good", "Content-Type": "application/json",
                        "x-goog-user-project": "proj", "Cookie": "no", "Host": "evil"},
            "body": '{"config":{}}',
        })
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], 200)
        self.assertEqual(base64.b64decode(body["bodyBase64"]), b'{"ok":true}')
        method, url = upstream.call_args.args
        kwargs = upstream.call_args.kwargs
        self.assertEqual((method, url), ("POST", "https://speech.googleapis.com/v1/speech:recognize"))
        self.assertEqual(kwargs["headers"], {"Authorization": "Bearer good", "Content-Type": "application/json",
                                             "x-goog-user-project": "proj"})
        self.assertEqual(kwargs["data"], b'{"config":{}}')
        self.assertIn("timeout", kwargs)

    @mock.patch("main.requests.request", return_value=google(content=bytes([137, 80, 0, 255]), content_type="image/png"))
    @mock.patch("main.requests.post", return_value=iam(["run.routes.invoke"]))
    def test_binary_both_ways(self, _post, upstream):
        status, body, _ = call({"url": "https://storage.googleapis.com/upload/storage/v1/b/b/o?uploadType=media&name=x",
                                "method": "POST", "bodyBase64": base64.b64encode(b"\x00\xff\x01").decode()})
        self.assertEqual(status, 200)
        self.assertEqual(upstream.call_args.kwargs["data"], b"\x00\xff\x01")
        self.assertEqual(base64.b64decode(body["bodyBase64"]), bytes([137, 80, 0, 255]))
        self.assertEqual(body["contentType"], "image/png")

    @mock.patch("main.requests.request", return_value=google(status=403, content=b'{"error":{"message":"denied"}}'))
    @mock.patch("main.requests.post", return_value=iam(["run.routes.invoke"]))
    def test_google_errors_are_passed_back(self, _post, _upstream):
        status, body, _ = call({"url": "https://vision.googleapis.com/v1/x", "method": "POST", "body": "{}"})
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], 403)

    @mock.patch("main.requests.post", return_value=iam(["run.routes.invoke"]))
    def test_bad_input(self, _post):
        self.assertEqual(call({"url": "https://vision.googleapis.com/v1/x", "method": "TRACE"})[0], 400)
        self.assertEqual(call({"url": "https://vision.googleapis.com/v1/x", "bodyBase64": "%%%"})[0], 400)
        self.assertEqual(call({"url": "https://vision.googleapis.com/v1/x", "body": 5})[0], 400)
        self.assertEqual(call(None)[0], 400)

    @mock.patch("main.requests.request", return_value=google())
    @mock.patch("main.requests.post", return_value=iam(["run.routes.invoke"]))
    def test_caller_check_is_cached(self, post, _upstream):
        call({"url": "https://vision.googleapis.com/v1/x"})
        call({"url": "https://vision.googleapis.com/v1/x"})
        self.assertEqual(post.call_count, 1)


if __name__ == "__main__":
    unittest.main()
