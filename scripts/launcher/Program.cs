using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

// MiMo 余额挂件启动器
//
// 目的：双击 .exe 就能启动，不闪黑框、不依赖 start.cmd 的管道/编码行为。
// 它自己不做任何业务逻辑，只负责：
//   1. 找同目录下的 Electron 运行时；
//   2. 找不到就提示并引导到 setup（或直接帮用户跑 setup.cmd -InstallDeps）；
//   3. 用正确的参数把 app 目录传给 electron.exe；
//   4. **保证"没反应"这件事不再发生**：已有实例、启动后立即退出、启动异常，都给提示。
//
// 注意：用 C# 5 语法（Windows 自带的 csc 4.0 只支持到 C# 5），别用字符串插值。

static class Program
{
    const string Title = "MiMo 余额挂件";
    const int StartupProbeMs = 1500;

    static string root = "";
    static bool trace = false;
    static string traceFile = "";

    static void Note(string message)
    {
        if (!trace) return;
        try { File.AppendAllText(traceFile, message + "\r\n", System.Text.Encoding.UTF8); }
        catch (Exception) { /* 追踪文件写不进去就放弃 */ }
    }

    // 自动化场景（--trace）下不能弹窗，否则会挂住测试；改成写文件
    static void Report(string message, MessageBoxIcon icon)
    {
        Note("dialog: " + message.Replace("\n", " "));
        if (trace) return;
        MessageBox.Show(message, Title, MessageBoxButtons.OK, icon);
    }

    static string LogHint()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            @"MiMoWhale\logs\app.log");
    }

    [STAThread]
    static int Main(string[] args)
    {
        root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        traceFile = Path.Combine(root, "launcher-trace.log");

        foreach (string arg in args)
        {
            if (arg == "--trace") trace = true;
        }
        if (trace) { try { File.Delete(traceFile); } catch (Exception) { } }

        string electron = Path.Combine(root, @"node_modules\electron\dist\electron.exe");
        Note("root=" + root);
        Note("electron=" + electron);

        if (args.Length > 0 && args[0] == "--check")
        {
            // 诊断模式：控制台可能是 GBK，先切到 UTF-8，否则中文路径会显示成乱码
            try { Console.OutputEncoding = System.Text.Encoding.UTF8; }
            catch (Exception) { /* 无控制台时忽略 */ }
            Console.WriteLine("root=" + root);
            Console.WriteLine("electron=" + electron);
            Console.WriteLine("found=" + File.Exists(electron));
            Console.WriteLine("running=" + AlreadyRunning(electron));
            return File.Exists(electron) ? 0 : 1;
        }

        if (!File.Exists(electron))
        {
            Note("electron missing -> prompting for setup");
            DialogResult answer = DialogResult.No;
            if (!trace)
            {
                answer = MessageBox.Show(
                    "找不到 Electron 运行时，启动必需（约 317 MB）。\n\n" +
                    "目录：" + root + "\n\n" +
                    "现在运行 setup.cmd -InstallDeps 安装吗？\n" +
                    "（需要 Node.js 18+，或改用自带运行时的便携包）",
                    Title,
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
            }
            if (answer == DialogResult.Yes) RunSetup(root);
            if (!File.Exists(electron)) return 2;
        }

        if (AlreadyRunning(electron))
        {
            // 单实例锁会让第二个进程静默退出——用户看到的就是"双击没反应"。
            Note("another instance is running");
            Report(
                "挂件已经在运行了，所以这次没有再启动。\n\n" +
                "如果看不到它：从任务栏托盘（右下角小图标）里找，或先在托盘菜单里退出再双击。",
                MessageBoxIcon.Information);
            return 0;
        }

        if (HasNonAscii(root))
        {
            // 实测结论：Electron 在这个目录下连日志都写不出来就直接退出。
            Note("non-ascii install path");
            DialogResult proceed = DialogResult.Yes;
            if (!trace)
            {
                proceed = MessageBox.Show(
                    "安装目录里有中文（或其它非 ASCII 字符）：\n" + root + "\n\n" +
                    "已验证这会直接导致 Electron 无法启动——表现为双击没反应、或窗口一闪而过。\n\n" +
                    "请把整个文件夹移动/复制到纯英文路径后再双击，例如：\n" +
                    "  C:\\Apps\\MiMo-Balance-Widget\n\n" +
                    "移动后不需要重新配置（程序启动时会更新位置记录）。\n\n" +
                    "仍要尝试启动吗？",
                    Title,
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
            }
            if (proceed != DialogResult.Yes)
            {
                Note("aborted by user because of non-ascii path");
                return 3;
            }
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(electron);
            psi.WorkingDirectory = root;
            psi.Arguments = "\"" + root + "\"";
            psi.UseShellExecute = false;
            // 某些工具会注入 ELECTRON_RUN_AS_NODE，那会让 electron.exe 退化成 Node
            try { psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE"); }
            catch (Exception) { /* 只读环境变量表时忽略 */ }

            Note("starting: " + electron + " \"" + root + "\"");
            Process child = Process.Start(psi);
            if (child == null)
            {
                Report("无法启动 Electron（Process.Start 返回空）。", MessageBoxIcon.Error);
                return 1;
            }
            Note("started pid=" + child.Id);

            // 等一小会儿：正常启动的话进程会一直活着；立刻退出说明有问题
            bool exitedEarly = child.WaitForExit(StartupProbeMs);
            if (!exitedEarly)
            {
                Note("still running after probe -> ok");
                return 0;
            }

            int code;
            try { code = child.ExitCode; }
            catch (Exception) { code = 0; }
            Note("child exited early code=" + code);

            if (code != 0)
            {
                Report(
                    "挂件启动后立即退出了（退出码 " + code + "）。\n\n" +
                    "常见原因：\n" +
                    "  1. 安装目录含中文/非 ASCII 字符（建议移到纯英文路径）\n" +
                    "  2. 安全软件拦截了 electron.exe\n" +
                    "  3. 显卡/远程桌面环境下 Chromium 初始化失败\n\n" +
                    "日志：" + LogHint(),
                    MessageBoxIcon.Error);
                return code;
            }

            Report(
                "挂件已经退出（退出码 0），但界面没有出现。\n\n" +
                "可能是窗口被隐藏、或另一份程序正在运行。\n" +
                "可以看日志确认：" + LogHint(),
                MessageBoxIcon.Warning);
            return 0;
        }
        catch (Exception ex)
        {
            Note("start failed: " + ex.GetType().Name + ": " + ex.Message);
            Report("启动失败：" + ex.Message, MessageBoxIcon.Error);
            return 1;
        }
    }

    /// <summary>路径里是否有非 ASCII 字符（中文会导致 Electron 启动失败）。</summary>
    static bool HasNonAscii(string value)
    {
        foreach (char ch in value)
        {
            if (ch > 127) return true;
        }
        return false;
    }

    /// <summary>是否已经有一份用同一个 electron.exe 跑着的实例。</summary>
    static bool AlreadyRunning(string electronPath)
    {
        try
        {
            foreach (Process p in Process.GetProcessesByName("electron"))
            {
                try
                {
                    string path = p.MainModule.FileName;
                    if (!string.IsNullOrEmpty(path) &&
                        string.Equals(path, electronPath, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
                catch (Exception) { /* 权限不足就跳过这个进程 */ }
            }
        }
        catch (Exception) { /* 枚举失败就当作没在运行 */ }
        return false;
    }

    static void RunSetup(string baseDir)
    {
        string script = Path.Combine(baseDir, "setup.ps1");
        Note("setup script=" + script);
        if (!File.Exists(script))
        {
            Report("找不到 setup.ps1，这个文件夹不完整。\n请重新解压便携包。", MessageBoxIcon.Error);
            return;
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe");
            psi.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File " +
                            "\"" + script + "\" -InstallDeps";
            psi.WorkingDirectory = baseDir;
            psi.UseShellExecute = true;
            Note("running setup...");
            Process.Start(psi).WaitForExit();
            Note("setup finished");
        }
        catch (Exception ex)
        {
            Note("setup failed: " + ex.Message);
            Report("运行 setup.ps1 失败：" + ex.Message, MessageBoxIcon.Error);
        }
    }
}
