# Do not run this unless you know what you're doing.
# Don't run this when Spud is open, or macOS can confuse the two versions (run in Terminal or another editor).

set -e


# Avoid running from inside the mounted Spud volume (create-dmg /Volumes/... issues).
# To fix permission errors: adjust permissions on your working Desktop folder as needed.
# Run in sudo if have errors


# Build, sign and package arm64
./mac-sign.sh build arm64
./mac-sign.sh sign arm64
./mac-sign.sh notarize arm64
./mac-sign.sh rawapp arm64
./mac-sign.sh hashrawapp arm64

# ./mac-sign.sh buildreh arm64
# ./mac-sign.sh packagereh arm64

# Build, sign and package x64
./mac-sign.sh build x64
./mac-sign.sh sign x64
./mac-sign.sh notarize x64
./mac-sign.sh rawapp x64
./mac-sign.sh hashrawapp x64

# ./mac-sign.sh buildreh x64
# ./mac-sign.sh packagereh x64

