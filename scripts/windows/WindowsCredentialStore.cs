// Derived from WindowsCredentialStore in OpenChatX:
// https://github.com/XiaoPuOuO/openchatx-mcp/blob/main/desktop/windows/Program.cs
// Copyright (c) 2026 Serbyte Development. Used under the MIT License.
// See THIRD_PARTY_NOTICES.md for the required license notice.

using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace OpenClawBridge
{
    public static class WindowsCredentialStore
    {
        private const uint CredTypeGeneric = 1;
        private const uint CredPersistLocalMachine = 2;
        private const int ErrorNotFound = 1168;
        private const int MaxCredentialBlobBytes = 2560;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct Credential
        {
            public uint Flags;
            public uint Type;
            [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
            [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
            public long LastWritten;
            public uint CredentialBlobSize;
            public IntPtr CredentialBlob;
            public uint Persist;
            public uint AttributeCount;
            public IntPtr Attributes;
            [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
            [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
        }

        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredWrite([In] ref Credential credential, uint flags);

        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credentialPtr);

        [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredDelete(string target, uint type, uint flags);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern void CredFree(IntPtr buffer);

        public static void Save(string target, string secret)
        {
            if (String.IsNullOrWhiteSpace(target)) throw new ArgumentException("Credential target is required.", "target");
            if (String.IsNullOrWhiteSpace(secret)) throw new ArgumentException("Credential secret is required.", "secret");

            byte[] bytes = Encoding.Unicode.GetBytes(secret);
            if (bytes.Length > MaxCredentialBlobBytes)
            {
                Array.Clear(bytes, 0, bytes.Length);
                throw new ArgumentException("Credential secret exceeds the Windows Credential Manager size limit.", "secret");
            }

            IntPtr blob = Marshal.AllocCoTaskMem(bytes.Length);
            try
            {
                Marshal.Copy(bytes, 0, blob, bytes.Length);
                Credential credential = new Credential
                {
                    Type = CredTypeGeneric,
                    TargetName = target,
                    Comment = String.Empty,
                    CredentialBlobSize = (uint)bytes.Length,
                    CredentialBlob = blob,
                    Persist = CredPersistLocalMachine,
                    UserName = Environment.UserName
                };

                if (!CredWrite(ref credential, 0))
                {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Could not save Windows Credential Manager entry.");
                }
            }
            finally
            {
                if (blob != IntPtr.Zero)
                {
                    Marshal.Copy(new byte[bytes.Length], 0, blob, bytes.Length);
                    Marshal.FreeCoTaskMem(blob);
                }
                Array.Clear(bytes, 0, bytes.Length);
            }
        }

        public static string Load(string target)
        {
            if (String.IsNullOrWhiteSpace(target)) throw new ArgumentException("Credential target is required.", "target");

            IntPtr credentialPtr;
            if (!CredRead(target, CredTypeGeneric, 0, out credentialPtr))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == ErrorNotFound) return null;
                throw new Win32Exception(error, "Could not read Windows Credential Manager entry.");
            }

            try
            {
                Credential credential = (Credential)Marshal.PtrToStructure(credentialPtr, typeof(Credential));
                if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0) return null;
                int characterCount = checked((int)credential.CredentialBlobSize / sizeof(char));
                return Marshal.PtrToStringUni(credential.CredentialBlob, characterCount);
            }
            finally
            {
                CredFree(credentialPtr);
            }
        }

        public static bool Delete(string target)
        {
            if (String.IsNullOrWhiteSpace(target)) throw new ArgumentException("Credential target is required.", "target");
            if (CredDelete(target, CredTypeGeneric, 0)) return true;
            int error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound) return false;
            throw new Win32Exception(error, "Could not delete Windows Credential Manager entry.");
        }
    }
}
