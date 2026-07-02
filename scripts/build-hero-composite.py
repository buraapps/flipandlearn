#!/usr/bin/env python3
"""
Composite the framed iPad + iPhone hero image for /en/learn-english/.

Layout A ("devices on a desk"):
  - iPad back-left, rotated 4° CCW, taller (~1250 px tall on canvas)
  - iPhone front-right, rotated 3° CW, shorter (~1100 px tall), overlaps iPad
  - Soft drop shadow behind each device (black @ 30%, blurred, offset down-right)
  - iPad shadow → iPad → iPhone shadow → iPhone (back-to-front)
  - Auto-cropped to remove excess transparent margins (~40px padding retained)

INPUTS (transparent background, pre-drawn iOS device frames from mockuphone.com):
  /Volumes/Data/BuraApps/screenshots-new/iphone-home-en-portrait.png
  /Volumes/Data/BuraApps/screenshots-new/ipad-gameplay-en-portrait.png

OUTPUT:
  /Volumes/Data/BuraApps/web/en/learn-english/img/learn-english-hero.png

Reproducible for other language landing pages: swap the two INPUT paths and
change the OUTPUT filename — layout maths stay identical.
"""
from PIL import Image, ImageFilter, ImageChops
import os, sys

# --- Paths ---
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_DIR  = "/Volumes/Data/BuraApps/screenshots-new"
IPHONE_SRC = os.path.join(INPUT_DIR, "iphone-home-en-portrait.png")
IPAD_SRC   = os.path.join(INPUT_DIR, "ipad-gameplay-en-portrait.png")
OUTPUT     = os.path.join(ROOT, "en/learn-english/img/learn-english-hero.png")

# --- Canvas ---
# Canvas is generously tall so drop shadows aren't clipped before auto-crop.
CANVAS_W, CANVAS_H = 1800, 1500

# --- iPad (back-left, upright) ---
IPAD_TARGET_H = 1300
IPAD_ROTATION_DEG = 0
IPAD_CENTER_X = 650
IPAD_TOP_Y    = 60

# --- iPhone (right, upright, bottom-aligned to iPad) ---
# Side-by-side layout: no overlap. iPhone sits `SIDE_GAP` px to the right of the
# iPad. Both bottoms aligned.
IPHONE_TARGET_H = 770          # 59% of iPad height — true physical proportion
IPHONE_ROTATION_DEG = 0
SIDE_GAP = 60                  # px between iPad's right edge and iPhone's left edge

# --- Shadows (per device) ---
# Tight contact shadow: straight down, small blur, higher opacity — grounds the
# device without becoming a soft glow.
SHADOW_OFFSET   = (0, 18)      # (dx, dy)
SHADOW_BLUR     = 25           # Gaussian blur radius
SHADOW_OPACITY  = 0.40         # of 255

# --- Auto-crop padding ---
CROP_PADDING = 20


def resize_h(im, target_h):
    w, h = im.size
    new_w = round(w * target_h / h)
    return im.resize((new_w, target_h), Image.LANCZOS)


def make_shadow(im_rgba, offset, blur, opacity):
    """Given a device image (RGBA), return an RGBA layer of its silhouette-shadow.
    The returned layer is padded so the blur+offset don't get clipped.
    Also returns the (x, y) offset to apply when compositing so the shadow lands
    correctly relative to where the device is pasted."""
    a = im_rgba.split()[-1]
    dx, dy = offset
    pad = blur * 3 + max(abs(dx), abs(dy))

    # Blank alpha canvas with extra padding on all sides.
    shadow_a = Image.new("L", (a.width + 2 * pad, a.height + 2 * pad), 0)
    shadow_a.paste(a, (pad + dx, pad + dy))
    shadow_a = shadow_a.filter(ImageFilter.GaussianBlur(blur))

    # Reduce opacity.
    shadow_a = shadow_a.point(lambda v: int(v * opacity))

    # Compose into black RGBA using the blurred alpha.
    shadow = Image.new("RGBA", shadow_a.size, (0, 0, 0, 0))
    black = Image.new("RGBA", shadow_a.size, (0, 0, 0, 255))
    shadow.paste(black, (0, 0), shadow_a)

    # Return the shadow layer AND the pad offset so caller can align it.
    return shadow, pad


def paste_at(canvas, layer, top_left):
    """Alpha-composite `layer` onto `canvas` at top-left position."""
    x, y = top_left
    # Ensure both are RGBA.
    if layer.mode != "RGBA":
        layer = layer.convert("RGBA")
    canvas.alpha_composite(layer, (x, y))


def paste_device_with_shadow(canvas, device, center_x, top_y):
    """Paste device shadow first, then the device itself, so the device sits on
    top of its own shadow. `center_x` is where the device's horizontal center
    lands on the canvas; `top_y` is where its top edge lands."""
    w, h = device.size
    x = center_x - w // 2

    # Shadow first
    shadow, pad = make_shadow(device, SHADOW_OFFSET, SHADOW_BLUR, SHADOW_OPACITY)
    paste_at(canvas, shadow, (x - pad, top_y - pad))

    # Then the device on top
    paste_at(canvas, device, (x, top_y))


def auto_crop(im, padding):
    """Trim fully-transparent margins, then re-pad by `padding` on all sides."""
    a = im.split()[-1]
    bbox = a.getbbox()
    if bbox is None:
        return im  # nothing to crop
    im = im.crop(bbox)

    # Re-pad to give breathing room.
    new_w = im.width + 2 * padding
    new_h = im.height + 2 * padding
    padded = Image.new("RGBA", (new_w, new_h), (0, 0, 0, 0))
    padded.alpha_composite(im, (padding, padding))
    return padded


def main():
    iphone = Image.open(IPHONE_SRC).convert("RGBA")
    ipad   = Image.open(IPAD_SRC).convert("RGBA")

    # Resize to target heights.
    ipad   = resize_h(ipad, IPAD_TARGET_H)
    iphone = resize_h(iphone, IPHONE_TARGET_H)

    # Rotate. expand=True grows the bbox so nothing is clipped.
    # PIL's rotate uses CCW positive angles.
    ipad_rot = ipad.rotate(IPAD_ROTATION_DEG,
                           resample=Image.BICUBIC, expand=True)
    iphone_rot = iphone.rotate(IPHONE_ROTATION_DEG,
                               resample=Image.BICUBIC, expand=True)

    # Build canvas.
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))

    # Compute iPhone position from iPad geometry.
    # - iPhone left edge sits OVERLAP_FRAC into the iPad's right side.
    # - iPhone is bottom-aligned to iPad (same bottom edge → "same surface").
    ipad_w, ipad_h = ipad_rot.size
    iphone_w, iphone_h = iphone_rot.size

    ipad_top    = IPAD_TOP_Y
    ipad_left   = IPAD_CENTER_X - ipad_w // 2
    ipad_right  = ipad_left + ipad_w
    ipad_bottom = ipad_top + ipad_h

    iphone_left     = ipad_right + SIDE_GAP
    iphone_center_x = iphone_left + iphone_w // 2
    iphone_bottom   = ipad_bottom
    iphone_top      = iphone_bottom - iphone_h

    # Paste back-to-front: iPad (with shadow), then iPhone (with shadow).
    paste_device_with_shadow(canvas, ipad_rot,
                             center_x=IPAD_CENTER_X, top_y=ipad_top)
    paste_device_with_shadow(canvas, iphone_rot,
                             center_x=iphone_center_x, top_y=iphone_top)

    # Auto-crop transparent margins, retain some padding.
    final = auto_crop(canvas, CROP_PADDING)

    # Save.
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    final.save(OUTPUT, "PNG", optimize=True)

    w, h = final.size
    size_kb = os.path.getsize(OUTPUT) / 1024
    print(f"wrote {OUTPUT}")
    print(f"dimensions: {w} x {h}")
    print(f"file size: {size_kb:.1f} KB")
    print(f"aspect ratio (w/h): {w / h:.3f}")

    # Report layout math actually used.
    side_gap_actual = iphone_left - ipad_right
    bottom_delta    = iphone_bottom - ipad_bottom
    print()
    print("--- layout debug ---")
    print(f"iPad bbox: {ipad_w} x {ipad_h}, "
          f"canvas pos ({ipad_left},{ipad_top})..({ipad_right},{ipad_bottom})")
    print(f"iPhone bbox: {iphone_w} x {iphone_h}, "
          f"canvas pos ({iphone_left},{iphone_top})..({iphone_left+iphone_w},{iphone_bottom})")
    print(f"side gap (iPad right → iPhone left): {side_gap_actual}px")
    print(f"bottom-alignment delta (iPhone_bottom - iPad_bottom): {bottom_delta}px")


if __name__ == "__main__":
    main()
