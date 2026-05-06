from rembg import remove
from PIL import Image
import io


def process_photo(input_path, output_path):
    try:
        with open(input_path, "rb") as f:
            input_data = f.read()

        output_data = remove(input_data)

        img = Image.open(io.BytesIO(output_data)).convert("RGBA")
        white_bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        white_bg.paste(img, mask=img.split()[3])
        final = white_bg.convert("RGB")

        max_size = 2048
        if max(final.size) > max_size:
            ratio = max_size / max(final.size)
            new_size = (int(final.width * ratio), int(final.height * ratio))
            final = final.resize(new_size, Image.LANCZOS)

        final.save(output_path, "JPEG", quality=90)
        return True
    except Exception as e:
        print(f"Background removal failed: {e}")
        try:
            img = Image.open(input_path).convert("RGB")
            if max(img.size) > 2048:
                ratio = 2048 / max(img.size)
                img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
            img.save(output_path, "JPEG", quality=90)
        except Exception:
            pass
        return False
