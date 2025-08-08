import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface IsotopeSpec {
    name: string;
    path: string;
    stages: string[];
    valid: boolean;
    lastModified: Date;
}

interface BuildResult {
    success: boolean;
    output: string;
    error?: string;
    duration: number;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Isotope Language Support is now active');

    // Set context for when Isotope files are present
    setIsotopeContext();

    // Initialize providers
    const completionProvider = new IsotopeCompletionProvider();
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('isotope');
    const validationProvider = new IsotopeValidationProvider(diagnosticCollection);
    const specsProvider = new IsotopeSpecsProvider(context);
    const buildHistoryProvider = new IsotopeBuildHistoryProvider(context);
    const templatesProvider = new IsotopeTemplatesProvider(context);

    // Register providers
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'isotope' },
            completionProvider,
            ' ', '=', '\n'
        )
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'isotope' },
            new IsotopeHoverProvider()
        )
    );

    // Register tree views
    vscode.window.createTreeView('isotopeSpecs', {
        treeDataProvider: specsProvider,
        showCollapseAll: true
    });

    vscode.window.createTreeView('isotopeBuildHistory', {
        treeDataProvider: buildHistoryProvider
    });

    vscode.window.createTreeView('isotopeTemplates', {
        treeDataProvider: templatesProvider
    });

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('isotope.build', async (uri?: vscode.Uri) => {
            await buildIsotope(uri, context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('isotope.validate', async (uri?: vscode.Uri) => {
            await validateIsotope(uri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('isotope.test', async (uri?: vscode.Uri) => {
            await testIsotope(uri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('isotope.convert', async () => {
            await convertJsonToIsotope();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('isotope.refreshSpecs', () => {
            specsProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('isotope.createSpec', async () => {
            await createNewSpec();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('isotope.openOutput', async () => {
            const outputDir = getOutputDirectory();
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(outputDir));
        })
    );

    // Watch for file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.isotope');
    watcher.onDidChange(e => {
        validationProvider.validateDocument(e);
        specsProvider.refresh();
    });
    watcher.onDidCreate(e => {
        setIsotopeContext();
        specsProvider.refresh();
    });
    watcher.onDidDelete(e => {
        setIsotopeContext();
        specsProvider.refresh();
    });
    context.subscriptions.push(watcher);

    // Validate on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId === 'isotope') {
                validationProvider.validateDocument(document.uri);
            }
        })
    );

    // Initial validation of open documents
    vscode.workspace.textDocuments.forEach(document => {
        if (document.languageId === 'isotope') {
            validationProvider.validateDocument(document.uri);
        }
    });
}

export function deactivate() {}

class IsotopeCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const linePrefix = document.lineAt(position).text.substring(0, position.character);
        const line = document.lineAt(position).text.trim();
        
        // Stage-aware completion
        const currentStage = getCurrentStage(document, position.line);
        
        // Keywords completion
        if (linePrefix.match(/^\s*$/)) {
            return this.getKeywordCompletions(currentStage);
        }

        // VM property completion
        if (linePrefix.match(/^\s*VM\s+$/)) {
            return this.getVmPropertyCompletions();
        }

        // VM provider completion
        if (linePrefix.match(/^\s*VM\s+provider=$/)) {
            return this.getVmProviderCompletions();
        }

        // Key completion for PRESS
        if (linePrefix.match(/^\s*PRESS\s+$/)) {
            return this.getKeyCompletions();
        }

        // Format completion
        if (linePrefix.match(/^\s*FORMAT\s+$/)) {
            return this.getFormatCompletions();
        }

        // Boolean completion
        if (linePrefix.match(/^\s*BOOTABLE\s+$/)) {
            return this.getBooleanCompletions();
        }

        return [];
    }

    private getKeywordCompletions(stage: string | null): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Global keywords
        const globalKeywords = ['FROM', 'CHECKSUM', 'LABEL'];
        globalKeywords.forEach(keyword => {
            const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
            item.documentation = this.getKeywordDocumentation(keyword);
            items.push(item);
        });

        // Stage keyword
        const stageItem = new vscode.CompletionItem('STAGE', vscode.CompletionItemKind.Keyword);
        stageItem.insertText = new vscode.SnippetString('STAGE ${1|init,os_install,os_configure,pack|}');
        stageItem.documentation = 'Define a build stage';
        items.push(stageItem);

        // Stage-specific keywords
        switch (stage) {
            case 'init':
                items.push(this.createCompletionItem('VM', 'VM ${1|provider,memory,cpus,disk,timeout,boot-wait|}=${2}', 'VM configuration'));
                break;
            case 'os_install':
                items.push(this.createCompletionItem('WAIT', 'WAIT ${1:30s}', 'Wait for a duration or condition'));
                items.push(this.createCompletionItem('PRESS', 'PRESS ${1|enter,tab,space,esc,up,down,left,right|}', 'Press a key'));
                items.push(this.createCompletionItem('TYPE', 'TYPE ${1:text}', 'Type text'));
                break;
            case 'os_configure':
                items.push(this.createCompletionItem('RUN', 'RUN ${1:command}', 'Execute a command'));
                items.push(this.createCompletionItem('COPY', 'COPY ${1:source} ${2:destination}', 'Copy files'));
                items.push(this.createCompletionItem('WAIT', 'WAIT ${1:30s}', 'Wait for a duration or condition'));
                items.push(this.createCompletionItem('PRESS', 'PRESS ${1|enter,tab,space,esc,up,down,left,right|}', 'Press a key'));
                items.push(this.createCompletionItem('TYPE', 'TYPE ${1:text}', 'Type text'));
                break;
            case 'pack':
                items.push(this.createCompletionItem('EXPORT', 'EXPORT ${1:./output/custom.iso}', 'Export ISO path'));
                items.push(this.createCompletionItem('FORMAT', 'FORMAT ${1|iso9660,udf|}', 'ISO format'));
                items.push(this.createCompletionItem('BOOTABLE', 'BOOTABLE ${1|true,false|}', 'Make ISO bootable'));
                items.push(this.createCompletionItem('VOLUME_LABEL', 'VOLUME_LABEL "${1:Custom OS}"', 'Volume label'));
                break;
        }

        return items;
    }

    private getVmPropertyCompletions(): vscode.CompletionItem[] {
        const properties = [
            { name: 'provider', values: ['qemu', 'virtualbox', 'vmware', 'hyperv'] },
            { name: 'memory', example: '4G' },
            { name: 'cpus', example: '2' },
            { name: 'disk', example: '20G' },
            { name: 'timeout', example: '30m' },
            { name: 'boot-wait', example: '10s' }
        ];

        return properties.map(prop => {
            const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
            if (prop.values) {
                item.insertText = new vscode.SnippetString(`${prop.name}=\${1|${prop.values.join(',')}|}`);
            } else {
                item.insertText = new vscode.SnippetString(`${prop.name}=\${1:${prop.example}}`);
            }
            return item;
        });
    }

    private getVmProviderCompletions(): vscode.CompletionItem[] {
        const providers = [
            { name: 'qemu', description: 'QEMU virtualization (recommended)' },
            { name: 'virtualbox', description: 'Oracle VirtualBox' },
            { name: 'vmware', description: 'VMware Workstation/Fusion' },
            { name: 'hyperv', description: 'Microsoft Hyper-V' }
        ];

        return providers.map(provider => {
            const item = new vscode.CompletionItem(provider.name, vscode.CompletionItemKind.Value);
            item.documentation = provider.description;
            return item;
        });
    }

    private getKeyCompletions(): vscode.CompletionItem[] {
        const keys = [
            'enter', 'tab', 'space', 'esc', 'escape',
            'up', 'down', 'left', 'right',
            'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
            'ctrl', 'alt', 'shift', 'win', 'cmd'
        ];

        return keys.map(key => new vscode.CompletionItem(key, vscode.CompletionItemKind.Value));
    }

    private getFormatCompletions(): vscode.CompletionItem[] {
        return [
            { name: 'iso9660', description: 'Standard ISO 9660 format' },
            { name: 'udf', description: 'Universal Disk Format' }
        ].map(format => {
            const item = new vscode.CompletionItem(format.name, vscode.CompletionItemKind.Value);
            item.documentation = format.description;
            return item;
        });
    }

    private getBooleanCompletions(): vscode.CompletionItem[] {
        return ['true', 'false'].map(value => 
            new vscode.CompletionItem(value, vscode.CompletionItemKind.Value)
        );
    }

    private createCompletionItem(label: string, snippet: string, documentation: string): vscode.CompletionItem {
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
        item.insertText = new vscode.SnippetString(snippet);
        item.documentation = documentation;
        return item;
    }

    private getKeywordDocumentation(keyword: string): string {
        const docs: { [key: string]: string } = {
            'FROM': 'Specify the source ISO file to build from',
            'CHECKSUM': 'Verify the source ISO with a checksum (sha256:hash)',
            'LABEL': 'Add metadata labels to the specification'
        };
        return docs[keyword] || '';
    }
}

class IsotopeHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;

        const word = document.getText(wordRange);
        const line = document.lineAt(position).text;

        const documentation = this.getDocumentation(word, line);
        if (documentation) {
            return new vscode.Hover(documentation);
        }

        return null;
    }

    private getDocumentation(word: string, line: string): vscode.MarkdownString | null {
        const docs: { [key: string]: string } = {
            'FROM': 'Specifies the source ISO file to build from.\n\nExample: `FROM ./ubuntu-22.04-server.iso`',
            'CHECKSUM': 'Verifies the integrity of the source ISO file.\n\nExample: `CHECKSUM sha256:a4acfda10b18da50e2ec50ccaf860d7f20ce1ee42895e3840b57b2b371fc734`',
            'LABEL': 'Adds metadata labels to the specification.\n\nExample: `LABEL name="custom-ubuntu"`',
            'STAGE': 'Defines a build stage. Valid stages are:\n- `init` - VM configuration\n- `os_install` - OS installation automation\n- `os_configure` - Live system configuration\n- `pack` - ISO packaging',
            'VM': 'Configures the puppet VM used for building.\n\nProperties: provider, memory, cpus, disk, timeout, boot-wait',
            'WAIT': 'Waits for a duration or condition.\n\nExamples:\n- `WAIT 30s`\n- `WAIT 5m FOR "Installation complete!"`',
            'PRESS': 'Simulates a key press.\n\nExample: `PRESS enter`',
            'TYPE': 'Types text into the VM.\n\nExample: `TYPE username`',
            'RUN': 'Executes a command in the live system.\n\nExample: `RUN apt-get update`',
            'COPY': 'Copies files into the live system.\n\nExample: `COPY ./config.json /etc/config.json`',
            'EXPORT': 'Specifies the output path for the generated ISO.\n\nExample: `EXPORT ./output/custom.iso`',
            'FORMAT': 'Sets the ISO format (iso9660 or udf).\n\nExample: `FORMAT iso9660`',
            'BOOTABLE': 'Makes the ISO bootable.\n\nExample: `BOOTABLE true`',
            'VOLUME_LABEL': 'Sets the volume label for the ISO.\n\nExample: `VOLUME_LABEL "Custom OS"`'
        };

        if (docs[word]) {
            return new vscode.MarkdownString(docs[word]);
        }

        return null;
    }
}

class IsotopeValidationProvider {
    constructor(private diagnosticCollection: vscode.DiagnosticCollection) {}

    async validateDocument(uri: vscode.Uri) {
        const config = vscode.workspace.getConfiguration('isotope');
        if (!config.get('validation.enabled')) return;

        try {
            const isotopePath = config.get<string>('executable.path') || 'isotope';
            const { stdout, stderr } = await execAsync(`"${isotopePath}" validate "${uri.fsPath}"`);
            
            // Clear diagnostics if validation passes
            this.diagnosticCollection.set(uri, []);
        } catch (error: any) {
            this.parseDiagnostics(uri, error.stdout || error.stderr || error.message);
        }
    }

    private parseDiagnostics(uri: vscode.Uri, output: string) {
        const diagnostics: vscode.Diagnostic[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            // Parse error format: "file:line:column: error: message"
            const match = line.match(/(.+):(\d+):(\d+):\s+(error|warning|info):\s+(.+)/);
            if (match) {
                const [, , lineStr, columnStr, severity, message] = match;
                const lineNumber = parseInt(lineStr) - 1;
                const column = parseInt(columnStr) - 1;

                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(lineNumber, column, lineNumber, column + 10),
                    message,
                    severity === 'error' ? vscode.DiagnosticSeverity.Error :
                    severity === 'warning' ? vscode.DiagnosticSeverity.Warning :
                    vscode.DiagnosticSeverity.Information
                );

                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticCollection.set(uri, diagnostics);
    }
}

class IsotopeSpecsProvider implements vscode.TreeDataProvider<IsotopeSpecItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<IsotopeSpecItem | undefined | null | void> = new vscode.EventEmitter<IsotopeSpecItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IsotopeSpecItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: IsotopeSpecItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: IsotopeSpecItem): Promise<IsotopeSpecItem[]> {
        if (!element) {
            return this.getIsotopeSpecs();
        }
        return [];
    }

    private async getIsotopeSpecs(): Promise<IsotopeSpecItem[]> {
        const specs: IsotopeSpecItem[] = [];
        
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const pattern = new vscode.RelativePattern(folder, '**/*.isotope');
                const files = await vscode.workspace.findFiles(pattern);
                
                for (const file of files) {
                    const spec = new IsotopeSpecItem(
                        path.basename(file.fsPath, '.isotope'),
                        file,
                        vscode.TreeItemCollapsibleState.None
                    );
                    spec.contextValue = 'isotopeSpec';
                    spec.iconPath = new vscode.ThemeIcon('file-code');
                    spec.command = {
                        command: 'vscode.open',
                        title: 'Open',
                        arguments: [file]
                    };
                    specs.push(spec);
                }
            }
        }

        return specs;
    }
}

class IsotopeSpecItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = resourceUri.fsPath;
        this.description = path.dirname(resourceUri.fsPath);
    }
}

class IsotopeBuildHistoryProvider implements vscode.TreeDataProvider<BuildHistoryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BuildHistoryItem | undefined | null | void> = new vscode.EventEmitter<BuildHistoryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BuildHistoryItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BuildHistoryItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BuildHistoryItem): Promise<BuildHistoryItem[]> {
        if (!element) {
            return this.getBuildHistory();
        }
        return [];
    }

    private async getBuildHistory(): Promise<BuildHistoryItem[]> {
        const history = this.context.globalState.get<BuildResult[]>('buildHistory') || [];
        return history.slice(0, 10).map(build => new BuildHistoryItem(build));
    }
}

class BuildHistoryItem extends vscode.TreeItem {
    constructor(build: BuildResult & { spec?: string }) {
        const label = `${build.spec || 'Unknown'} - ${build.success ? '✓' : '✗'}`;
        super(label, vscode.TreeItemCollapsibleState.None);
        
        this.description = `${(build.duration / 1000).toFixed(1)}s`;
        this.tooltip = build.success ? 'Build succeeded' : build.error;
        this.iconPath = new vscode.ThemeIcon(build.success ? 'check' : 'error');
    }
}

class IsotopeTemplatesProvider implements vscode.TreeDataProvider<TemplateItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TemplateItem | undefined | null | void> = new vscode.EventEmitter<TemplateItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TemplateItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TemplateItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TemplateItem): Promise<TemplateItem[]> {
        if (!element) {
            return this.getTemplates();
        }
        return [];
    }

    private async getTemplates(): Promise<TemplateItem[]> {
        const templates = [
            { name: 'Ubuntu Server', description: 'Ubuntu Server with Docker' },
            { name: 'Windows 11 Dev', description: 'Windows 11 development environment' },
            { name: 'Minimal Linux', description: 'Minimal Linux distribution' }
        ];

        return templates.map(template => new TemplateItem(template.name, template.description));
    }
}

class TemplateItem extends vscode.TreeItem {
    constructor(
        public readonly name: string,
        public readonly description: string
    ) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = new vscode.ThemeIcon('file-text');
    }
}

// Utility functions
function getCurrentStage(document: vscode.TextDocument, currentLine: number): string | null {
    for (let i = currentLine; i >= 0; i--) {
        const line = document.lineAt(i).text.trim();
        const stageMatch = line.match(/^STAGE\s+(init|os_install|os_configure|pack)/);
        if (stageMatch) {
            return stageMatch[1];
        }
    }
    return null;
}

function getOutputDirectory(): string {
    const config = vscode.workspace.getConfiguration('isotope');
    return config.get<string>('build.outputDirectory') || './output';
}

async function setIsotopeContext() {
    const hasIsotopeFiles = await vscode.workspace.findFiles('**/*.isotope').then(files => files.length > 0);
    vscode.commands.executeCommand('setContext', 'workspaceHasIsotopeFiles', hasIsotopeFiles);
    vscode.commands.executeCommand('setContext', 'isotopeExtensionActive', true);
}

async function buildIsotope(uri?: vscode.Uri, context?: vscode.ExtensionContext) {
    const specUri = uri || vscode.window.activeTextEditor?.document.uri;
    if (!specUri || !specUri.fsPath.endsWith('.isotope')) {
        vscode.window.showErrorMessage('Please select an Isotope specification file');
        return;
    }

    const config = vscode.workspace.getConfiguration('isotope');
    const isotopePath = config.get<string>('executable.path') || 'isotope';
    const outputDir = config.get<string>('build.outputDirectory') || './output';

    const startTime = Date.now();
    
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Building ${path.basename(specUri.fsPath)}`,
        cancellable: true
    }, async (progress, token) => {
        return new Promise<void>((resolve, reject) => {
            const args = ['build', specUri.fsPath, '--output', path.join(outputDir, `${path.basename(specUri.fsPath, '.isotope')}.iso`)];
            const process = spawn(isotopePath, args);

            let output = '';
            let error = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
                progress.report({ message: data.toString().split('\n')[0] });
            });

            process.stderr.on('data', (data) => {
                error += data.toString();
            });

            process.on('close', (code) => {
                const duration = Date.now() - startTime;
                const success = code === 0;

                // Store build history
                if (context) {
                    const history = context.globalState.get<BuildResult[]>('buildHistory') || [];
                    history.unshift({
                        success,
                        output,
                        error: success ? undefined : error,
                        duration,
                        spec: path.basename(specUri.fsPath)
                    } as BuildResult & { spec: string });
                    context.globalState.update('buildHistory', history.slice(0, 20));
                }

                if (success) {
                    vscode.window.showInformationMessage(`Build completed successfully in ${(duration / 1000).toFixed(1)}s`);
                    resolve();
                } else {
                    vscode.window.showErrorMessage(`Build failed: ${error}`);
                    reject(new Error(error));
                }
            });

            token.onCancellationRequested(() => {
                process.kill();
                reject(new Error('Build cancelled'));
            });
        });
    });
}

async function validateIsotope(uri?: vscode.Uri) {
    const specUri = uri || vscode.window.activeTextEditor?.document.uri;
    if (!specUri || !specUri.fsPath.endsWith('.isotope')) {
        vscode.window.showErrorMessage('Please select an Isotope specification file');
        return;
    }

    const config = vscode.workspace.getConfiguration('isotope');
    const isotopePath = config.get<string>('executable.path') || 'isotope';

    try {
        const { stdout } = await execAsync(`"${isotopePath}" validate "${specUri.fsPath}"`);
        vscode.window.showInformationMessage('✓ Specification is valid');
    } catch (error: any) {
        vscode.window.showErrorMessage(`Validation failed: ${error.message}`);
    }
}

async function testIsotope(uri?: vscode.Uri) {
    const specUri = uri || vscode.window.activeTextEditor?.document.uri;
    if (!specUri || !specUri.fsPath.endsWith('.isotope')) {
        vscode.window.showErrorMessage('Please select an Isotope specification file');
        return;
    }

    const config = vscode.workspace.getConfiguration('isotope');
    const isotopePath = config.get<string>('executable.path') || 'isotope';

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Testing ${path.basename(specUri.fsPath)}`,
        cancellable: false
    }, async () => {
        try {
            const { stdout } = await execAsync(`"${isotopePath}" test "${specUri.fsPath}"`);
            vscode.window.showInformationMessage('✓ VM boot test passed');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
        }
    });
}

async function convertJsonToIsotope() {
    const jsonFiles = await vscode.workspace.findFiles('**/*.json', '**/node_modules/**');
    if (jsonFiles.length === 0) {
        vscode.window.showErrorMessage('No JSON files found in workspace');
        return;
    }

    const selected = await vscode.window.showQuickPick(
        jsonFiles.map(file => ({ label: path.basename(file.fsPath), uri: file })),
        { placeHolder: 'Select JSON file to convert' }
    );

    if (!selected) return;

    const outputPath = selected.uri.fsPath.replace('.json', '.isotope');
    
    const config = vscode.workspace.getConfiguration('isotope');
    const isotopePath = config.get<string>('executable.path') || 'isotope';

    try {
        await execAsync(`"${isotopePath}" convert "${selected.uri.fsPath}" "${outputPath}"`);
        const doc = await vscode.workspace.openTextDocument(outputPath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`Converted to ${path.basename(outputPath)}`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Conversion failed: ${error.message}`);
    }
}

async function createNewSpec() {
    const templates = [
        { label: 'Ubuntu Server', template: 'ubuntu-server' },
        { label: 'Windows 11', template: 'windows-11' },
        { label: 'Empty Specification', template: 'empty' }
    ];

    const selected = await vscode.window.showQuickPick(templates, {
        placeHolder: 'Select a template'
    });

    if (!selected) return;

    const name = await vscode.window.showInputBox({
        prompt: 'Enter specification name',
        placeHolder: 'my-custom-os'
    });

    if (!name) return;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    const filePath = path.join(workspaceFolder.uri.fsPath, `${name}.isotope`);
    const template = getTemplate(selected.template);

    await fs.promises.writeFile(filePath, template);
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
}

function getTemplate(templateName: string): string {
    const templates: { [key: string]: string } = {
        'ubuntu-server': `# ${new Date().toISOString().split('T')[0]} - Ubuntu Server Custom Build
FROM ./ubuntu-22.04-server.iso
CHECKSUM sha256:a4acfda10b18da50e2ec50ccaf860d7f20ce1ee42895e3840b57b2b371fc734

LABEL name="ubuntu-custom"
LABEL version="1.0.0"
LABEL description="Custom Ubuntu Server"

STAGE init
VM provider=qemu
VM memory=4G
VM cpus=2
VM disk=20G

STAGE os_install
# Add your installation sequence here
WAIT 30s
PRESS enter

STAGE os_configure
# Add your configuration commands here
RUN apt-get update

STAGE pack
EXPORT ./output/ubuntu-custom.iso
FORMAT iso9660
BOOTABLE true
VOLUME_LABEL "Ubuntu Custom"
`,
        'windows-11': `# ${new Date().toISOString().split('T')[0]} - Windows 11 Custom Build
FROM ./Win11_Pro.iso
CHECKSUM sha256:8c31fd4c4523f1404450758d51f8780cb5faeedcaa4fdeab8e1d6808f5d51c62

LABEL name="win11-custom"
LABEL version="1.0.0"
LABEL description="Custom Windows 11"

STAGE init
VM provider=virtualbox
VM memory=8G
VM cpus=4
VM disk=40G

STAGE os_install
# Add your installation sequence here
WAIT 60s
PRESS enter

STAGE os_configure
# Add your configuration commands here

STAGE pack
EXPORT ./output/win11-custom.iso
FORMAT udf
BOOTABLE true
VOLUME_LABEL "Windows 11 Custom"
`,
        'empty': `# ${new Date().toISOString().split('T')[0]} - New Isotope Specification
FROM ./source.iso
# CHECKSUM sha256:your_hash_here

LABEL name="custom-os"
LABEL version="1.0.0"
LABEL description="Custom OS Build"

STAGE init
VM provider=qemu
VM memory=4G
VM cpus=2

STAGE os_install
# Add installation automation here

STAGE os_configure  
# Add configuration commands here

STAGE pack
EXPORT ./output/custom-os.iso
BOOTABLE true
`
    };

    return templates[templateName] || templates['empty'];
}