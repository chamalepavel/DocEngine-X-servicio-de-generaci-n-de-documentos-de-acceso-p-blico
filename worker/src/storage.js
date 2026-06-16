const fs = require("fs");
const path = require("path");

const useS3 = !!(
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_REGION &&
  process.env.AWS_BUCKET_NAME
);

async function saveFile(fileName, pdfBuffer) {
  if (useS3) {
    return await uploadToS3(fileName, pdfBuffer);
  }
  return saveLocally(fileName, pdfBuffer);
}

async function uploadToS3(fileName, pdfBuffer) {
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

  const client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const key = `documents/${fileName}`;
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    })
  );

  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

function saveLocally(fileName, pdfBuffer) {
  const dir = path.join(__dirname, "../../uploads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, fileName), pdfBuffer);

  const base = process.env.BASE_URL || "http://localhost:4000";
  return `${base}/uploads/${fileName}`;
}

module.exports = { saveFile };
