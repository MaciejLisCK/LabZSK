﻿using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Configuration.Install;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Deinstalator
{
    [RunInstaller(true)]
    public partial class Installer : System.Configuration.Install.Installer
    {
        public Installer()
        {
            InitializeComponent();
            DialogResult dr = MessageBox.Show("Czy instalator ma usunąć wszystkie pliki utworzone w 'Moje Dokumenty'?\nWykasowane zostaną WSZYSTKIE pliki wraz z folderem LabZkt.","Deinstalacja" ,MessageBoxButtons.YesNo);
            if (dr == DialogResult.Yes)
                Directory.Delete(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) + "\\LabZkt", true);
        }
    }
}
