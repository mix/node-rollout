set term png
set output 'results.png'

set key off
set border 3
set style fill solid 1.0 noborder

bin_width=1
bin(x,width)=width*floor(x/width)

plot 'results.txt' using (bin($1,bin_width)):(1.0) smooth freq with boxes