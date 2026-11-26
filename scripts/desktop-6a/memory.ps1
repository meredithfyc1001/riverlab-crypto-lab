param([Parameter(Mandatory = $true)][int]$RootProcessId)
$ErrorActionPreference = 'Stop'
# All descendants of this test-owned PID, including the WebView2 browser, GPU
# and renderers. Working sets may count shared pages more than once.
while (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue) {
    $processes = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, WorkingSetSize, PrivatePageCount)
    $children = @{}
    foreach ($p in $processes) {
        $parentId = [int]$p.ParentProcessId
        if (!$children.ContainsKey($parentId)) {
            $children[$parentId] = [System.Collections.Generic.List[object]]::new()
        }
        $children[$parentId].Add($p)
    }
    $root = $processes | Where-Object ProcessId -eq $RootProcessId
    if (!$root) { break }
    $queue = [System.Collections.Generic.Queue[object]]::new()
    $queue.Enqueue($root)
    $visited = [System.Collections.Generic.HashSet[int]]::new()
    [long]$workingSet = 0
    [long]$privateBytes = 0
    while ($queue.Count -gt 0) {
        $p = $queue.Dequeue()
        $procId = [int]$p.ProcessId
        if (!$visited.Add($procId)) { continue }
        $workingSet += [long]$p.WorkingSetSize
        $privateBytes += [long]$p.PrivatePageCount
        if ($children.ContainsKey($procId)) {
            foreach ($child in $children[$procId]) { $queue.Enqueue($child) }
        }
    }
    [Console]::WriteLine((@{
        utcMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        processCount = $visited.Count
        workingSetBytes = $workingSet
        privateBytes = $privateBytes
    } | ConvertTo-Json -Compress))
    Start-Sleep -Milliseconds 350
}
