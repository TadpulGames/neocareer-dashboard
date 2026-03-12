#!/bin/bash

# Detect operating system
OS=$(uname -s)

# Set the target directory based on OS
if [[ "$OS" == "Darwin" ]]; then
   # Mac - use home directory path

   TARGET_DIR="$HOME/Tadpul/Builds/NEORECRUIT/ADMIN/STAGE/public/"
else
   # Windows (Git Bash, WSL, etc.) - keep original D: path
   TARGET_DIR="D:/Tadpul/Builds/ADMIN/STAGE/public/"
fi

# Check if the target directory exists
if [ -d "$TARGET_DIR" ]; then
   echo "Directory exists. Synchronizing files..."
else
   echo "Directory does not exist. Creating the directory..."
   mkdir -p "$TARGET_DIR"
fi

# Synchronize files from build to the target directory
cp -rf build/* "$TARGET_DIR"

# Remove empty directories from the source after moving
#find build -type d -empty -delete

echo "Operation completed."

# Change directory to the target directory
cd "$TARGET_DIR" || exit
# Then go back one directory (to the parent)
cd ..

firebase deploy --only hosting:neorecruit-admin-stage

# Open file manager based on OS
if [[ "$OS" == "Darwin" ]]; then
   # Mac - use Finder
   open .
else
   # Windows - use Explorer
   explorer.exe .
fi