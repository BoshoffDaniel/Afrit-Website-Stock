from PIL import Image, ImageDraw, ImageFont


def make_icons():
    img = Image.new("RGBA", (256, 256), "#2d8a4e")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 120)
    except OSError:
        font = ImageFont.load_default()

    text = "CM"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (256 - tw) // 2
    y = (256 - th) // 2 - 8
    draw.text((x, y), text, fill="white", font=font)

    img.save("icon.png", "PNG")
    img.save("icon.ico", format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("Created icon.png and icon.ico")


if __name__ == "__main__":
    make_icons()
