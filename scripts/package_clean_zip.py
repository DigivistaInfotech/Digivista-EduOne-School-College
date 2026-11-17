import os
import zipfile
import sys

def package_clean_zip():
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    output_zip = os.path.abspath(os.path.join(project_root, '..', 'asterleaf-school-erp-complete.zip'))
    
    print(f"Packaging clean source code from: {project_root}")
    print(f"Output destination: {output_zip}")
    
    ignored_dirs = {'node_modules', '.git', 'dist', '.turbo', '.cache', 'tmp', '.system_generated'}
    
    file_count = 0
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in ignored_dirs]
            for file in files:
                if file.endswith('.log') or file == '.DS_Store':
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, project_root)
                # Store with prefix folder for clean extraction
                arcname = os.path.join('asterleaf-school-erp', rel_path)
                zip_file.write(full_path, arcname)
                file_count += 1
                
    size_mb = os.path.getsize(output_zip) / (1024 * 1024)
    print(f"SUCCESS: Packaged {file_count} files into clean archive.")
    print(f"Archive size: {size_mb:.2f} MB")
    print(f"Path: {output_zip}")

if __name__ == '__main__':
    package_clean_zip()
