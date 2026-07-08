import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Upload, X, RefreshCw, Check, HelpCircle } from 'lucide-react';

// Friendly, device-aware help shown when the browser blocks the camera.
function CameraPermissionHelp() {
  const [open, setOpen] = useState(true);
  const isApple = typeof navigator !== 'undefined' && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  return (
    <div className="mt-3 text-left bg-amber-50 border border-amber-200 rounded-lg p-3">
      <button type="button" onClick={() => setOpen(o => !o)} className="text-xs font-semibold text-amber-800 flex items-center gap-1">
        <HelpCircle size={14} /> How to turn on the camera {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-2 text-xs text-amber-900 space-y-2">
          {isApple ? (
            <div>
              <p className="font-semibold">On an iPad / iPhone (Safari):</p>
              <ol className="list-decimal ml-4 space-y-0.5 mt-1">
                <li>Tap the "aA" icon on the left side of the address bar.</li>
                <li>Tap "Website Settings".</li>
                <li>Set "Camera" to "Allow".</li>
                <li>Come back here and tap "Try again" below.</li>
              </ol>
              <p className="mt-1">If you don't see it: open the Settings app → Safari → Camera → Allow, then reload the page.</p>
            </div>
          ) : (
            <div>
              <p className="font-semibold">On an Android tablet (Chrome):</p>
              <ol className="list-decimal ml-4 space-y-0.5 mt-1">
                <li>Tap the lock / sliders icon on the left of the address bar.</li>
                <li>Tap "Permissions" (or "Camera").</li>
                <li>Turn "Camera" ON / set to Allow.</li>
                <li>Come back here and tap "Try again" below.</li>
              </ol>
              <p className="mt-1">If nothing happens the first time, tap "Try again" and choose "Allow" when the pop-up appears.</p>
            </div>
          )}
          <p className="text-amber-700">No camera? You can still use the USB scanner — switch back to "USB Scanner" above.</p>
        </div>
      )}
    </div>
  );
}

// Live camera QR / barcode scanner for tablets & phones.
// Calls onScan(code) when a code is decoded. Debounces duplicate reads.
export function CameraScanner({ onScan }) {
  const containerId = 'checkin-camera-region';
  const scannerRef = useRef(null);
  const lastScanRef = useRef({ code: '', time: 0 });
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [starting, setStarting] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setDenied(false);
    setStarting(true);
    const html5Qr = new Html5Qrcode(containerId, { verbose: false });
    scannerRef.current = html5Qr;

    const config = { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.2 };

    const onSuccess = (decodedText) => {
      const now = Date.now();
      if (decodedText === lastScanRef.current.code && now - lastScanRef.current.time < 3000) return;
      lastScanRef.current = { code: decodedText, time: now };
      // short vibration feedback where supported
      if (navigator.vibrate) navigator.vibrate(120);
      onScan(decodedText);
    };

    const fail = (err) => {
      if (cancelled) return;
      setStarting(false);
      const name = (err && (err.name || err.message || err.toString())) || '';
      const isDenied = /NotAllowed|Permission|denied/i.test(name);
      const noCam = /NotFound|Devices|OverConstrained|no camera/i.test(name);
      setDenied(isDenied);
      setError(
        isDenied
          ? 'The camera is blocked for this site. Turn it on with the quick steps below, then tap "Try again".'
          : noCam
            ? 'No usable camera was found on this device. You can use the USB / Bluetooth scanner instead (tap "USB / Bluetooth Scanner" above).'
            : 'Could not start the camera. Make sure no other app is using it and the tablet is unlocked, then tap "Try again" — or use the USB / Bluetooth scanner.'
      );
    };

    // Robust start: enumerate cameras and pick the back camera when possible.
    // Falls back through several strategies for tablets where facingMode alone fails.
    const started = () => { if (!cancelled) setStarting(false); };

    const startWithFacing = () => html5Qr.start({ facingMode: 'environment' }, config, onSuccess, () => {});
    const startWithUser = () => html5Qr.start({ facingMode: 'user' }, config, onSuccess, () => {});

    Html5Qrcode.getCameras()
      .then((cameras) => {
        if (cancelled) return;
        if (!cameras || cameras.length === 0) { fail({ name: 'NotFoundError' }); return; }
        // Prefer a rear/back/environment camera; else the last one (often the back cam on tablets).
        const back = cameras.find(c => /back|rear|environment/i.test(c.label || ''));
        const chosen = back || cameras[cameras.length - 1];
        return html5Qr.start(chosen.id, config, onSuccess, () => {})
          .then(started)
          .catch(() => startWithFacing().then(started))
          .catch(() => {
            // last resort: first camera by id, then user-facing
            return html5Qr.start(cameras[0].id, config, onSuccess, () => {})
              .then(started)
              .catch(() => startWithUser().then(started));
          });
      })
      .catch((err) => {
        // getCameras failed (often = permission denied). Try a direct facingMode start once.
        if (cancelled) return;
        startWithFacing().then(started).catch(() => fail(err));
      });

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        if (s.getState && s.getState() === 2) {
          s.stop().then(() => s.clear()).catch(() => {});
        } else {
          try { s.clear(); } catch {}
        }
      }
    };
  }, [onScan, retryKey]);

  return (
    <div>
      <div id={containerId} className="w-full rounded-lg overflow-hidden bg-black" style={{ minHeight: 240 }} />
      {starting && !error && (
        <p className="text-xs text-gray-500 mt-2 text-center flex items-center justify-center gap-1">
          <RefreshCw size={12} className="animate-spin" /> Starting camera...
        </p>
      )}
      {error && (
        <div className="mt-2 text-center">
          <p className="text-xs text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => setRetryKey(k => k + 1)}
            className="mt-2 inline-flex items-center gap-1 btn bg-primary-700 text-white hover:bg-primary-800 text-sm"
          >
            <RefreshCw size={14} /> Try again
          </button>
          {denied && <CameraPermissionHelp />}
        </div>
      )}
      {!starting && !error && (
        <p className="text-xs text-gray-400 mt-2 text-center">Hold the member's card steady inside the frame.</p>
      )}
    </div>
  );
}

// Photo-based scanner: uses the tablet's OWN camera app (via a native file input
// with capture) to snap a photo of the member's QR/barcode, then decodes it from
// the image. This works even inside the installed home-screen app, where the live
// browser camera (getUserMedia) is blocked. Calls onScan(code) on a successful read.
export function PhotoScanner({ onScan }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | reading | error
  const [err, setErr] = useState('');

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('reading');
    setErr('');
    const scanner = new Html5Qrcode('photo-scan-region', { verbose: false });
    try {
      const decoded = await scanner.scanFile(file, false);
      if (navigator.vibrate) navigator.vibrate(120);
      setStatus('idle');
      onScan((decoded || '').trim());
    } catch (e2) {
      setStatus('error');
      setErr("Couldn't read the code in that photo. Hold the card steady, fill the frame, and keep it in focus — then tap Take Photo of Code again.");
    } finally {
      try { await scanner.clear(); } catch {}
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="text-center">
      {/* Off-screen work area the decoder needs; not shown to the user. */}
      <div id="photo-scan-region" style={{ position: 'fixed', left: '-10000px', top: 0, width: 320 }} />
      <label className="btn bg-primary-700 text-white hover:bg-primary-800 w-full py-3 cursor-pointer flex items-center justify-center gap-2">
        <Camera size={18} /> Take Photo of Code
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      </label>
      <p className="text-xs text-gray-500 mt-2">
        Tap the button, choose your Camera, and snap a clear photo of the member's QR code or barcode. The system reads it and checks them in. This works on the tablet even inside the installed app.
      </p>
      {status === 'reading' && (
        <p className="text-xs text-gray-500 mt-2 flex items-center justify-center gap-1">
          <RefreshCw size={12} className="animate-spin" /> Reading the code...
        </p>
      )}
      {status === 'error' && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}

// Photo capture for new guests: take a photo with the tablet/phone camera (via the
// device's own camera app) OR upload an existing image. Calls onChange(File).
export function PhotoCapture({ onChange }) {
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const [preview, setPreview] = useState('');

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    onChange(file);
  };

  const clearPhoto = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview('');
    onChange(null);
    if (fileRef.current) fileRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
  };

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Photo (optional)</label>

      {preview ? (
        <div className="flex items-center gap-3">
          <img src={preview} alt="" className="w-20 h-24 object-cover rounded-lg border-2 border-green-300" />
          <div className="flex flex-col gap-2">
            <span className="text-xs text-green-700 font-medium flex items-center gap-1"><Check size={14} /> Photo ready</span>
            <button type="button" onClick={clearPhoto} className="text-xs text-red-600 hover:underline flex items-center gap-1">
              <X size={12} /> Remove / retake
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {/* Uses the device's own camera app — works on the tablet even inside the installed app. */}
          <label className="btn bg-primary-700 text-white hover:bg-primary-800 flex items-center gap-2 cursor-pointer">
            <Camera size={16} /> Take Photo
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
          </label>
          <label className="btn bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-2 cursor-pointer">
            <Upload size={16} /> Upload Photo
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </label>
        </div>
      )}
    </div>
  );
}
