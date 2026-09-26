import base64
import mimetypes

image_path = "testImgs/img1.png"
output_path = "testOutput.txt"

# Detect image MIME type
mime_type, _ = mimetypes.guess_type(image_path)

if mime_type is None:
    raise ValueError("Could not determine image type")

# Read image as binary
with open(image_path, "rb") as image_file:
    encoded = base64.b64encode(image_file.read()).decode("utf-8")

# Create data URI
base64_image = f"{encoded}"

# Save Base64 string
with open(output_path, "w") as output_file:
    output_file.write(base64_image)

print(f"Converted {image_path}")
print(f"Saved Base64 string to {output_path}")