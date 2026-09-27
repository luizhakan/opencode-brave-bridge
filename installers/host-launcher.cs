using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;

internal static class HostLauncher
{
    private static int Main(string[] args)
    {
        try
        {
            string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "host-config.json");
            LauncherConfig config;
            using (FileStream file = File.OpenRead(configPath))
                config = (LauncherConfig)new DataContractJsonSerializer(typeof(LauncherConfig)).ReadObject(file);
            if (config == null || !Path.IsPathRooted(config.NodePath) || !Path.IsPathRooted(config.HostPath))
                throw new InvalidDataException("Launcher config must contain absolute nodePath and hostPath paths.");
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = Path.GetFullPath(config.NodePath);
            start.Arguments = QuoteArgument(Path.GetFullPath(config.HostPath));
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;

            using (Process child = new Process())
            {
                child.StartInfo = start;
                if (!child.Start())
                    throw new InvalidOperationException("Could not start node.exe.");

                Stream input = Console.OpenStandardInput();
                Stream output = Console.OpenStandardOutput();
                Stream error = Console.OpenStandardError();

                Task stdin = Pump(input, child.StandardInput.BaseStream, true);
                Task stdout = Pump(child.StandardOutput.BaseStream, output, false);
                Task stderr = Pump(child.StandardError.BaseStream, error, false);

                child.WaitForExit();
                try { Task.WaitAll(new Task[] { stdin, stdout, stderr }); }
                catch (AggregateException) { }
                return child.ExitCode;
            }
        }
        catch (Exception ex)
        {
            WriteError("Native host launcher: " + ex.Message + "\n");
            return 1;
        }
    }

    private static Task Pump(Stream source, Stream destination, bool closeDestination)
    {
        return Task.Factory.StartNew(delegate
        {
            try
            {
                byte[] buffer = new byte[81920];
                int count;
                while ((count = source.Read(buffer, 0, buffer.Length)) != 0)
                {
                    destination.Write(buffer, 0, count);
                    destination.Flush();
                }
            }
            catch (IOException) { }
            catch (ObjectDisposedException) { }
            finally
            {
                if (closeDestination) try { destination.Dispose(); } catch { }
            }
        }, TaskCreationOptions.LongRunning);
    }

    private static string QuoteArgument(string value)
    {
        System.Text.StringBuilder result = new System.Text.StringBuilder();
        result.Append('"');
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); slashes = 0; continue; }
            result.Append('\\', slashes); slashes = 0; result.Append(c);
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }

    [DataContract]
    private sealed class LauncherConfig
    {
        [DataMember(Name = "nodePath")] public string NodePath { get; set; }
        [DataMember(Name = "hostPath")] public string HostPath { get; set; }
    }

    private static void WriteError(string value)
    {
        byte[] bytes = System.Text.Encoding.UTF8.GetBytes(value);
        try { Console.OpenStandardError().Write(bytes, 0, bytes.Length); } catch { }
    }
}
