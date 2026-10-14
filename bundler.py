import os

OUTPUT_FILE = "bundle.txt"
SCRIPT_NAME = "bundler.py"

IGNORE_DIRS = {
    "bundles",
    "re621.Legacy-master",
    "__pycache__",
    ".vscode",
    "build",
    "dist",
    ".git",
    "assets",
    "tests",
}

IGNORE_FILES = {
    SCRIPT_NAME,
    OUTPUT_FILE,
    "__init__.py",
    "userscript-build.js",
    "userscript-fix.js",
    "LICENSE",
    ".gitignore",
    ".gitattributes"
}

ALLOWED_EXTENSIONS = {".py", ".json", ".js", ".css", ".html"}


def optimize_code(content):
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in content.split("\n")]

    optimized_lines = []
    is_prev_empty = False
    for line in lines:
        if not line:
            if not is_prev_empty:
                optimized_lines.append("")
                is_prev_empty = True
        else:
            optimized_lines.append(line)
            is_prev_empty = False

    while optimized_lines and not optimized_lines[0]:
        optimized_lines.pop(0)
    while optimized_lines and not optimized_lines[-1]:
        optimized_lines.pop()

    return "\n".join(optimized_lines)


def generate_bundle():
    root_dir = os.getcwd()
    bundle_path = os.path.join(root_dir, OUTPUT_FILE)

    file_count = 0

    with open(bundle_path, "w", encoding="utf-8", newline="\n") as outfile:
        outfile.write(f'<project root="{os.path.basename(root_dir)}">\n\n')
        for dirpath, dirnames, filenames in os.walk(root_dir):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]

            for filename in filenames:
                file_ext = os.path.splitext(filename)[1].lower()

                if file_ext not in ALLOWED_EXTENSIONS:
                    continue

                full_path = os.path.join(dirpath, filename)
                rel_path = os.path.relpath(full_path, root_dir)
                norm_rel_path = rel_path.replace(os.sep, "/")

                if filename in IGNORE_FILES or norm_rel_path in IGNORE_FILES:
                    continue

                try:
                    with open(full_path, "r", encoding="utf-8") as infile:
                        content = infile.read()

                    clean_content = optimize_code(content)

                    outfile.write(f'<file path="{norm_rel_path}">\n')
                    outfile.write(clean_content)
                    outfile.write("\n</file>\n\n")

                    print(f"[+] United: {rel_path}")
                    file_count += 1
                except Exception as e:
                    print(f"[!] Error reading {rel_path}: {e}")

        outfile.write("</project>\n")

    print(f"\nSuccessfully! Files united: {file_count}.")
    print(f"Result saved to: {bundle_path}")

if __name__ == "__main__":
    generate_bundle()