import os

# Имя итогового файла
OUTPUT_FILE = "bundle.txt"
# Имя самого скрипта (чтобы он не записывал сам себя)
SCRIPT_NAME = "bundler.py"

# Папки, которые мы полностью игнорируем
IGNORE_DIRS = {
    "bundles",
    "re621.Legacy-master",
    "__pycache__",
    ".vscode",
    "build",
    "dist",
    ".git",
    "assets",  # Игнорируем картинки и звуки
    "tests",   # Игнорируем тестовые файлы
}

# Расширения файлов, которые нужно объединить
ALLOWED_EXTENSIONS = {".py", ".json", ".js", ".css", ".html"}  # При необходимости можно добавить ".json", ".md" и др.

def optimize_code(content):
    """
    Оптимизирует исходный код для уменьшения количества токенов:
    - Приводит все переводы строк к формату LF (\n).
    - Удаляет невидимые пробелы на концах строк (trailing whitespaces).
    - Сжимает несколько идущих подряд пустых строк в одну.
    - Убирает лишние пустые строки в самом начале и конце файла.
    """
    # Нормализуем переводы строк
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    
    # Разбиваем на строки и убираем пробелы в конце каждой строки
    lines = [line.rstrip() for line in content.split("\n")]
    
    # Сжимаем дублирующиеся пустые строки
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
            
    # Удаляем пустые строки в начале и конце файла
    while optimized_lines and not optimized_lines[0]:
        optimized_lines.pop(0)
    while optimized_lines and not optimized_lines[-1]:
        optimized_lines.pop()
        
    return "\n".join(optimized_lines)

def generate_bundle():
    root_dir = os.getcwd()
    bundle_path = os.path.join(root_dir, OUTPUT_FILE)
    
    file_count = 0

    # Явно указываем newline="\n", чтобы Python на Windows принудительно записывал LF вместо CRLF
    with open(bundle_path, "w", encoding="utf-8", newline="\n") as outfile:
        # Используем лаконичный XML-подобный тег для обозначения проекта
        outfile.write(f'<project root="{os.path.basename(root_dir)}">\n\n')

        # Рекурсивный обход директорий
        for dirpath, dirnames, filenames in os.walk(root_dir):
            # Исключаем ненужные папки на лету
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]

            for filename in filenames:
                # Пропускаем сам бандлер, итоговый файл и файлы инициализации пакетов
                if filename in (SCRIPT_NAME, OUTPUT_FILE, "__init__.py"):
                    continue

                # Проверяем расширение файла
                file_ext = os.path.splitext(filename)[1].lower()
                if file_ext in ALLOWED_EXTENSIONS:
                    full_path = os.path.join(dirpath, filename)
                    rel_path = os.path.relpath(full_path, root_dir)

                    try:
                        with open(full_path, "r", encoding="utf-8") as infile:
                            content = infile.read()

                        # Очищаем код от лишнего мусора перед записью
                        clean_content = optimize_code(content)

                        # Заменяем ASCII-баннеры (====) на компактные XML-теги <file>
                        # Относительный путь записывается в виде атрибута path
                        outfile.write(f'<file path="{rel_path.replace(os.sep, "/")}">\n')
                        outfile.write(clean_content)
                        outfile.write("\n</file>\n\n")
                        
                        print(f"[+] Объединен: {rel_path}")
                        file_count += 1
                    except Exception as e:
                        print(f"[!] Ошибка чтения {rel_path}: {e}")

        outfile.write("</project>\n")

    print(f"\nУспешно! Объединено файлов: {file_count}.")
    print(f"Результат сохранен в: {bundle_path}")

if __name__ == "__main__":
    generate_bundle()