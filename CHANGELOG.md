# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [0.2.14] - 2024-03-21

- Fixed file overrides being cleared when switching to an empty profile
- Fixed rare issue where it was possible for mods to fail deploying certain types

## [0.2.13] - 2024-03-13

- Fixed error when accessing conflicts before conflict calculation completed
- Fixed another instance where redundant file overrides were *not* being removed
- Fixed preview not working in override editor

## [0.2.12] - 2024-03-12

- Fixed redundant file override test removing entries incorrectly.
- Fixed pointless redundant file override state changes when nothing changed.
- Fixed manually created file overrides not saved upon restart.
- Fixed purge event executed needlessly when no mod type conflicts are detected.
