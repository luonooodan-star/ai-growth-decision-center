"""Configure the shared TikTok upload token on the decision center host."""
import getpass
import os
from pathlib import Path
import tempfile

token = getpass.getpass("广告上传工具共用的 TikTok Access-Token（隐藏输入）: ").strip()
if not token or not token.isascii() or not token.isprintable():
    raise SystemExit("Access-Token 无效")
folder = Path(__file__).resolve().parents[2] / "runtime" / "tiktok"
folder.mkdir(mode=0o700, parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile(mode="w", dir=folder, delete=False) as output:
    output.write(token)
os.replace(output.name, folder / "access-token")
print("已保存共享余额配置，回到决策平台刷新即可。")
