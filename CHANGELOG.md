# Change Log

All notable changes to the Isotope Language Support extension will be documented in this file.

## [1.0.0] - 2025-01-08

### Added
- **Complete Language Support**: Full syntax highlighting for Isotope specifications
- **IntelliSense & Auto-completion**: Context-aware suggestions for all keywords and values
- **Real-time Validation**: Live error detection using Isotope CLI integration
- **Stage-Aware Completions**: Smart completions based on current build stage (init, os_install, os_configure, pack)
- **Hover Documentation**: Instant help for keywords and instructions
- **Integrated Build System**: One-click ISO building directly from VS Code
- **Progress Tracking**: Real-time build progress with cancellation support
- **Dedicated Sidebar**: Three-panel interface for specifications, build history, and templates
- **Build History**: Track and review previous builds with success/failure indicators
- **Template System**: Pre-built templates for Ubuntu Server, Windows 11, and custom builds
- **JSON Conversion**: Convert legacy JSON configurations to Isotope format
- **Multi-Workspace Support**: Works across multiple workspace folders
- **Command Palette Integration**: All features accessible via Ctrl/Cmd+Shift+P
- **Custom Theme**: Optimized dark theme for Isotope syntax
- **Keyboard Shortcuts**: F5 to build, Shift+F5 to validate, Ctrl+F5 to test
- **Problem Panel Integration**: All validation errors displayed in VS Code Problems panel
- **File Watcher**: Automatic refresh when Isotope files change
- **Configuration Options**: Comprehensive settings for CLI path, validation, and build options

### Features
- **Syntax Highlighting**: Custom TextMate grammar with semantic highlighting
- **Smart Validation**: Syntax, semantic, and value validation with inline diagnostics
- **Context Actions**: Right-click build, validate, and test operations in explorer
- **Template Gallery**: Quick-start templates accessible from sidebar
- **Output Management**: Automatic handling of build output directories
- **Cross-Platform**: Full Windows, macOS, and Linux support

### Language Features
- **Keywords**: FROM, CHECKSUM, LABEL, STAGE, VM, WAIT, PRESS, TYPE, RUN, COPY, EXPORT, FORMAT, BOOTABLE, VOLUME_LABEL
- **Stage Types**: init, os_install, os_configure, pack
- **VM Providers**: qemu, virtualbox, vmware, hyperv
- **Key Names**: All standard keyboard keys with auto-completion
- **Value Validation**: Memory sizes (4G, 2048M), durations (30s, 5m), booleans, file paths
- **Template Variables**: ${VAR} syntax with highlighting

## [Unreleased]

### Planned
- **Live Preview**: Real-time specification preview in sidebar
- **Snippet Library**: Expandable code snippets for common patterns
- **Diff View**: Compare specifications and build outputs
- **Remote Development**: Dev Container and Codespaces support  
- **Testing Framework**: Automated testing of specifications
- **Import/Export**: Specification sharing and collaboration features